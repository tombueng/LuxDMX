// ---------------------------------------------------------------------------
// menu.h — a tiny generic on-display menu driven by nav events (issue #24).
// Pure / host-tested (only <stdint.h> + <string.h>).
//
// The menu is a flat list of items. Each item is either a VALUE (an int the user
// scrolls to change, e.g. a universe) or an ACTION (e.g. "Exit"). Two modes:
//
//   BROWSE  INC/DEC move the highlight between enabled items (wrapping),
//           ENTER either starts editing a VALUE or fires an ACTION,
//           BACK closes the menu.
//   EDIT    INC/DEC change the working value (wrapping between vmin..vmax),
//           ENTER commits it (the caller then persists), BACK discards.
//
// The caller (main.cpp) owns the semantics: it builds the item list when the menu
// opens, and on a commit/action reads the result and applies it (save config,
// re-join sACN, close on Exit, ...). Nothing here touches hardware or config, so
// it all runs in a host unit test.
//
// Design notes:
//  - Disabled items (enabled == false) are skipped by navigation and not drawn,
//    so "Output B universe" simply vanishes on a single-output unit — no special
//    cases in the renderer.
//  - There is always meant to be an Exit ACTION item, so a unit with only one
//    button (which can't produce BACK) can still leave the menu.
// ---------------------------------------------------------------------------
#ifndef MENU_H
#define MENU_H

#include <stdint.h>
#include <string.h>
#include "input_map.h"   // NavEvent

enum MenuMode : uint8_t { MENU_CLOSED = 0, MENU_BROWSE = 1, MENU_EDIT = 2 };
enum MenuItemKind : uint8_t { MI_VALUE = 0, MI_ACTION = 1 };

static constexpr int MENU_MAX_ITEMS = 8;
static constexpr int MENU_LABEL_LEN = 12;

struct MenuItem {
    char     label[MENU_LABEL_LEN] = {0};
    uint8_t  id      = 0;            // caller's tag, echoed back on commit/action
    uint8_t  kind    = MI_VALUE;
    bool     enabled = true;
    int32_t  value   = 0;           // VALUE: current committed value
    int32_t  vmin    = 0;
    int32_t  vmax    = 0;           // inclusive; edit wraps vmin..vmax
};

// What handle() reports back after one event. All the "somethinghappened" flags
// are false on a plain navigation move (the caller still redraws on `changed`).
struct MenuResult {
    bool    changed     = false;    // visible state moved -> redraw
    bool    closed      = false;    // menu just closed (BACK in BROWSE, or caller closed it)
    int16_t committedId = -1;       // >=0: a VALUE item was committed; read `value`
    int16_t actionId    = -1;       // >=0: an ACTION item fired
    int32_t value       = 0;
};

struct Menu {
    MenuItem items[MENU_MAX_ITEMS];
    uint8_t  count = 0;
    MenuMode mode  = MENU_CLOSED;
    int8_t   sel   = 0;             // highlighted index (always an enabled item while open)
    int32_t  edit  = 0;             // working value while editing

    void clear() { count = 0; mode = MENU_CLOSED; sel = 0; edit = 0; }

    void addValue(uint8_t id, const char* label, int32_t v, int32_t mn, int32_t mx, bool enabled = true) {
        if (count >= MENU_MAX_ITEMS) return;
        MenuItem& it = items[count++];
        strncpy(it.label, label, MENU_LABEL_LEN - 1); it.label[MENU_LABEL_LEN - 1] = 0;
        it.id = id; it.kind = MI_VALUE; it.enabled = enabled;
        it.value = v; it.vmin = mn; it.vmax = mx;
    }
    void addAction(uint8_t id, const char* label, bool enabled = true) {
        if (count >= MENU_MAX_ITEMS) return;
        MenuItem& it = items[count++];
        strncpy(it.label, label, MENU_LABEL_LEN - 1); it.label[MENU_LABEL_LEN - 1] = 0;
        it.id = id; it.kind = MI_ACTION; it.enabled = enabled;
    }

    int enabledCount() const {
        int n = 0; for (int i = 0; i < count; i++) if (items[i].enabled) n++; return n;
    }
    int firstEnabled() const {
        for (int i = 0; i < count; i++) if (items[i].enabled) return i; return -1;
    }
    // Next/prev enabled index from `from`, wrapping. Returns `from` if it's the
    // only enabled one, or -1 if none are.
    int stepEnabled(int from, int dir) const {
        if (enabledCount() == 0) return -1;
        int i = from;
        for (int n = 0; n < count; n++) {
            i = (i + dir + count) % count;
            if (items[i].enabled) return i;
        }
        return from;
    }

    // Open in BROWSE mode with the highlight on the first enabled item. Call after
    // (re)building the item list.
    void open() {
        mode = MENU_BROWSE;
        int f = firstEnabled();
        sel = (int8_t)(f < 0 ? 0 : f);
    }
    void close() { mode = MENU_CLOSED; }
    bool isOpen() const { return mode != MENU_CLOSED; }

    static int32_t wrap(int32_t v, int32_t mn, int32_t mx) {
        int32_t span = mx - mn + 1;
        if (span <= 0) return mn;
        return ((v - mn) % span + span) % span + mn;
    }

    MenuResult handle(NavEvent e) {
        MenuResult r;
        if (mode == MENU_CLOSED || e == NAV_NONE) return r;

        if (mode == MENU_BROWSE) {
            switch (e) {
                case NAV_INC: { int n = stepEnabled(sel, +1); if (n >= 0 && n != sel) { sel = (int8_t)n; r.changed = true; } } break;
                case NAV_DEC: { int n = stepEnabled(sel, -1); if (n >= 0 && n != sel) { sel = (int8_t)n; r.changed = true; } } break;
                case NAV_ENTER:
                    if (sel < 0 || sel >= count) break;
                    if (items[sel].kind == MI_ACTION) {
                        r.actionId = items[sel].id; r.changed = true;
                    } else {
                        mode = MENU_EDIT; edit = items[sel].value; r.changed = true;
                    }
                    break;
                case NAV_BACK:
                    close(); r.closed = true; r.changed = true;
                    break;
                default: break;
            }
            return r;
        }

        // MENU_EDIT
        MenuItem& it = items[sel];
        switch (e) {
            case NAV_INC: edit = wrap(edit + 1, it.vmin, it.vmax); r.changed = true; break;
            case NAV_DEC: edit = wrap(edit - 1, it.vmin, it.vmax); r.changed = true; break;
            case NAV_ENTER:
                it.value = edit;
                r.committedId = it.id; r.value = edit; r.changed = true;
                mode = MENU_BROWSE;
                break;
            case NAV_BACK:                 // discard the in-progress edit
                mode = MENU_BROWSE; r.changed = true;
                break;
            default: break;
        }
        return r;
    }
};

#endif  // MENU_H
