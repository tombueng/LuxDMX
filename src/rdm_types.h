// ---------------------------------------------------------------------------
// rdm_types.h -- the RDM (ANSI E1.20) types and constants this firmware needs.
//
// These used to come from someweisguy/esp_dmx. We stopped using that library's
// driver when DMX moved to the RMT peripheral (issue #64) and RDM followed it
// (RMT-TX + a RX-only UART, see rdm_rmt.h), but we kept pulling the whole
// library in just for these declarations. That is gone now: everything below is
// straight out of the E1.20 standard, so it is ours to declare.
//
// Names and layouts are deliberately identical to what esp_dmx used, so this is
// a drop-in swap rather than a rename across the RDM code.
//
// Note on layout: rdm_rmt.h fills these field by field out of the raw parameter
// data, with explicit shifts for the big-endian wire values. It never memcpy()s
// a response over a whole struct. So these layouts are NOT wire-critical and you
// can add a field without breaking the parse. The packed attributes are kept
// because the structs mirror E1.20 parameter data and it would be a nasty
// surprise for someone who later does reach for memcpy. If you go that route,
// check the sizes against the standard first (DEVICE_INFO is 19 bytes,
// SENSOR_VALUE is 9, SENSOR_DEFINITION is 13 plus the description tail).
// ---------------------------------------------------------------------------
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// A full DMX512 packet: the start code plus 512 slots (E1.11).
#define DMX_PACKET_SIZE (513)

// E1.20 caps ASCII parameter data at 32 characters; +1 so we can always
// NUL-terminate what a responder sends us before handing it to String/printf.
#define RDM_ASCII_SIZE_MAX (33)

// --- Identity ---------------------------------------------------------------

/** @brief Controllers and responders identify themselves with a 48-bit UID:
 * a 16-bit ESTA manufacturer ID (0x0001..0x7fff) plus a 32-bit device ID. */
typedef struct __attribute__((packed)) rdm_uid_t {
    uint16_t man_id;
    uint32_t dev_id;
} rdm_uid_t;

/** @brief Broadcast to every device regardless of manufacturer. Responders must
 * not reply to this, so never wait for an ack after sending to it. */
static const rdm_uid_t RDM_UID_BROADCAST_ALL = {0xffff, 0xffffffff};

/** @brief The largest valid (non-broadcast) UID. Used as the upper bound when
 * seeding a DISC_UNIQUE_BRANCH binary search. */
static const rdm_uid_t RDM_UID_MAX = {0xffff, 0xfffffffe};

static inline bool rdm_uid_is_eq(const rdm_uid_t* a, const rdm_uid_t* b) {
    return a->man_id == b->man_id && a->dev_id == b->dev_id;
}

// printf helpers for a UID, used together:  printf("uid " UIDSTR "\n", UID2STR(uid));
#define UIDSTR "%04x:%08lx"
#define UID2STR(uid) (uid).man_id, (uid).dev_id

// --- Message framing --------------------------------------------------------

/** @brief The root device, as opposed to one of its sub-devices. Every request
 * this firmware sends is addressed to the root. */
enum { RDM_SUB_DEVICE_ROOT = 0 };

/** @brief Command class: what kind of message this is. */
typedef enum {
    RDM_CC_DISC_COMMAND          = 0x10,
    RDM_CC_DISC_COMMAND_RESPONSE = 0x11,
    RDM_CC_GET_COMMAND           = 0x20,
    RDM_CC_GET_COMMAND_RESPONSE  = 0x21,
    RDM_CC_SET_COMMAND           = 0x30,
    RDM_CC_SET_COMMAND_RESPONSE  = 0x31,
} rdm_cc_t;

/** @brief Parameter ID. Deliberately a plain 16-bit value and not an enum: a
 * responder may answer with any PID, including manufacturer-specific ones we
 * have never heard of, and those have to survive a round trip through the Art-Net
 * RDM relay unchanged. The named constants below are only the ones this
 * controller sends or parses itself; the standard defines many more. */
typedef uint16_t rdm_pid_t;

enum {
    RDM_PID_DISC_UNIQUE_BRANCH       = 0x0001,
    RDM_PID_DISC_MUTE                = 0x0002,
    RDM_PID_DISC_UN_MUTE             = 0x0003,
    RDM_PID_STATUS_MESSAGE           = 0x0030,
    RDM_PID_DEVICE_INFO              = 0x0060,
    RDM_PID_DEVICE_MODEL_DESCRIPTION = 0x0080,
    RDM_PID_MANUFACTURER_LABEL       = 0x0081,
    RDM_PID_DEVICE_LABEL             = 0x0082,
    RDM_PID_SOFTWARE_VERSION_LABEL   = 0x00c0,
    RDM_PID_DMX_PERSONALITY          = 0x00e0,
    RDM_PID_DMX_START_ADDRESS        = 0x00f0,
    RDM_PID_SENSOR_DEFINITION        = 0x0200,
    RDM_PID_SENSOR_VALUE             = 0x0201,
    RDM_PID_IDENTIFY_DEVICE          = 0x1000,
};

/** @brief How a responder answered. INVALID and NONE are ours, not E1.20's:
 * they mark "the response was malformed" and "nothing came back at all", which
 * the standard has no code for because it only describes real responses. */
typedef enum {
    RDM_RESPONSE_TYPE_ACK          = 0x00,
    RDM_RESPONSE_TYPE_ACK_TIMER    = 0x01,
    RDM_RESPONSE_TYPE_NACK_REASON  = 0x02,
    RDM_RESPONSE_TYPE_ACK_OVERFLOW = 0x03,
    RDM_RESPONSE_TYPE_INVALID      = 0xfe,
    RDM_RESPONSE_TYPE_NONE         = 0xff,
} rdm_response_type_t;

/** @brief NACK reason, sent as the parameter data of a NACK_REASON response. */
typedef uint16_t rdm_nr_t;

/** @brief Why a read failed, if it did. rdm_rmt.h reports failure through its
 * bool return, so in practice this is always DMX_OK; the field stays because
 * the ack struct is what the app layer reads. */
typedef enum {
    DMX_OK = 0,
} dmx_err_t;

/** @brief What came back from a request. */
typedef struct rdm_ack_t {
    /** @brief Non-zero if reading the response failed. */
    dmx_err_t err;
    /** @brief Size of the response packet in bytes. */
    size_t size;
    /** @brief UID of the device that answered. */
    rdm_uid_t src_uid;
    /** @brief PID of the response, normally echoing the request's. */
    rdm_pid_t pid;
    /** @brief Response type: ACK, NACK, or one of our two "no usable answer"
     * markers. Callers check this before trusting the parameter data. */
    rdm_response_type_t type;
    /** @brief Responder's queued-message count. Non-zero means it has status
     * messages waiting for collection. */
    int message_count;
    union {
        /** @brief Parameter data length, when type is ACK. */
        size_t pdl;
        /** @brief Milliseconds until the responder is ready, when the type is
         * ACK_TIMER. (esp_dmx expressed this in FreeRTOS ticks.) */
        uint32_t timer;
        /** @brief Why the request was refused, when the type is NACK_REASON. */
        rdm_nr_t nack_reason;
    };
} rdm_ack_t;

// --- Parameter payloads -----------------------------------------------------

/** @brief The device's current DMX personality and how many it supports.
 * Personalities are numbered from 1. */
typedef struct __attribute__((packed)) rdm_dmx_personality_t {
    uint8_t current;
    uint8_t count;
} rdm_dmx_personality_t;

/** @brief GET DEVICE_INFO response. The two leading bytes are the RDM protocol
 * version (always 1.0); they are unnamed because nothing reads them, but they
 * must stay so the struct still matches the wire layout byte for byte. */
typedef struct __attribute__((packed)) rdm_device_info_t {
    uint8_t : 8;   // RDM major version, always 1
    uint8_t : 8;   // RDM minor version, always 0
    uint16_t model_id;
    uint16_t product_category;
    uint32_t software_version_id;
    /** @brief Number of consecutive DMX slots the device occupies. */
    uint16_t footprint;
    rdm_dmx_personality_t personality;
    /** @brief 0xffff when the footprint is 0 (the device patches nowhere). */
    uint16_t dmx_start_address;
    uint16_t sub_device_count;
    uint8_t  sensor_count;
} rdm_device_info_t;

/** @brief GET SENSOR_DEFINITION response: what a sensor measures and its range. */
typedef struct __attribute__((packed)) rdm_sensor_definition_t {
    /** @brief Sensor number, 0 to 0xfe. */
    uint8_t num;
    /** @brief What is being measured (temperature, voltage, ...). */
    uint8_t type;
    /** @brief SI unit of the readings, one of the RDM_UNITS_* values. */
    uint8_t unit;
    /** @brief Decimal prefix applied to the readings (kilo, milli, ...), as a
     * signed power of ten. */
    uint8_t prefix;
    struct {
        int16_t minimum;
        int16_t maximum;
    } range;
    struct {
        int16_t minimum;
        int16_t maximum;
    } normal;
    uint8_t recorded_value_support : 1;
    uint8_t lowest_highest_detected_value_support : 1;
    uint8_t : 6;   // reserved, sent as 0
    char description[RDM_ASCII_SIZE_MAX];
} rdm_sensor_definition_t;

/** @brief GET SENSOR_VALUE response. The lowest/highest/recorded fields are
 * optional in E1.20; a responder that does not track them sends 0. */
typedef struct __attribute__((packed)) rdm_sensor_value_t {
    uint8_t sensor_num;
    int16_t present_value;
    int16_t lowest_value;
    int16_t highest_value;
    int16_t recorded_value;
} rdm_sensor_value_t;

/** @brief What a sensor measures (E1.20 table A-12). Only the types the web UI
 * knows how to label are listed; anything else shows up as a bare number. */
typedef enum {
    RDM_SENSOR_TYPE_TEMPERATURE      = 0x00,
    RDM_SENSOR_TYPE_VOLTAGE          = 0x01,
    RDM_SENSOR_TYPE_CURRENT          = 0x02,
    RDM_SENSOR_TYPE_FREQUENCY        = 0x03,
    RDM_SENSOR_TYPE_POWER            = 0x05,
    RDM_SENSOR_TYPE_TIME             = 0x10,
    RDM_SENSOR_TYPE_ANGULAR_VELOCITY = 0x15,
    RDM_SENSOR_TYPE_HUMIDITY         = 0x1f,
} rdm_sensor_type_t;

/** @brief Sensor units (E1.20 table A-13). Only the ones the web UI knows how
 * to label are listed. */
typedef enum {
    RDM_UNITS_NONE           = 0x00,
    RDM_UNITS_CENTIGRADE     = 0x01,
    RDM_UNITS_VOLTS_DC       = 0x02,
    RDM_UNITS_VOLTS_AC_PEAK  = 0x03,
    RDM_UNITS_VOLTS_AC_RMS   = 0x04,
    RDM_UNITS_AMPERE_DC      = 0x05,
    RDM_UNITS_AMPERE_AC_PEAK = 0x06,
    RDM_UNITS_AMPERE_AC_RMS  = 0x07,
    RDM_UNITS_HERTZ          = 0x08,
    RDM_UNITS_OHM            = 0x09,
    RDM_UNITS_WATT           = 0x0a,
    RDM_UNITS_KILOGRAM       = 0x0b,
    RDM_UNITS_METERS         = 0x0c,
    RDM_UNITS_SECOND         = 0x15,
    RDM_UNITS_DEGREE         = 0x16,
    RDM_UNITS_LUX            = 0x1a,
    RDM_UNITS_BYTE           = 0x1c,
} rdm_units_t;
