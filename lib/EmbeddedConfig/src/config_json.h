#pragma once
#include <Arduino.h>
#include <functional>

// ---------------------------------------------------------------------------
// Minimal JSON reader for the config backup file (issue #108). Not a general parser: it walks
// the members of ONE object. A scalar member (string / number / true / false / null) comes back
// as text, a nested object or array comes back as the raw slice of the input so the caller can
// walk that one too or store it verbatim. Enough for {"config":{...},"labels":{...}} and nothing
// more, which keeps it small and keeps ArduinoJson out of a build that has no other use for it.
// ---------------------------------------------------------------------------
namespace cfgjson {

enum class Kind : uint8_t { String, Number, Bool, Null, Object, Array };

struct Member {
    String      key;
    Kind        kind;
    String      text;       // scalars: unescaped string, number as written, "true"/"false"
    const char* raw;        // Object/Array: the value's text, braces included
    size_t      rawLen;
};

// Calls fn for each member of the object in json[0..len), in order. fn returns false to stop
// early (that is not an error). Returns false + err on malformed input or trailing garbage.
bool eachMember(const char* json, size_t len, const std::function<bool(const Member&)>& fn, String& err);

// JSON string literal for s, quotes included.
String quote(const String& s);

} // namespace cfgjson
