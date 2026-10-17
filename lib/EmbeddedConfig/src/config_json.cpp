#include "config_json.h"
#include <ctype.h>
#include <stdio.h>
#include <string.h>

namespace cfgjson {

namespace {

struct Reader {
    const char* p;
    const char* end;
    String      err;

    void ws() { while (p < end && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')) p++; }
    bool fail(const char* what) { if (!err.length()) err = what; return false; }

    static void putUtf8(String& out, uint32_t cp) {
        if (cp < 0x80)        { out += (char)cp; }
        else if (cp < 0x800)  { out += (char)(0xC0 | (cp >> 6)); out += (char)(0x80 | (cp & 0x3F)); }
        else                  { out += (char)(0xE0 | (cp >> 12)); out += (char)(0x80 | ((cp >> 6) & 0x3F));
                                out += (char)(0x80 | (cp & 0x3F)); }
    }
    static int hexv(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }

    // At an opening quote. Leaves p after the closing one.
    bool str(String& out) {
        if (p >= end || *p != '"') return fail("expected a string");
        p++;
        while (p < end && *p != '"') {
            char c = *p++;
            if ((uint8_t)c < 0x20) return fail("control character in a string");
            if (c != '\\') { out += c; continue; }
            if (p >= end) return fail("unterminated escape");
            char e = *p++;
            switch (e) {
                case '"': out += '"'; break;   case '\\': out += '\\'; break;
                case '/': out += '/'; break;   case 'b': out += '\b'; break;
                case 'f': out += '\f'; break;  case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;  case 't': out += '\t'; break;
                case 'u': {
                    if (end - p < 4) return fail("short \\u escape");
                    uint32_t cp = 0;
                    for (int i = 0; i < 4; i++) { int h = hexv(p[i]); if (h < 0) return fail("bad \\u escape"); cp = cp * 16 + h; }
                    p += 4;
                    // A surrogate pair is two escapes; nothing in a config needs one, so a lone or
                    // paired surrogate just becomes '?' rather than invalid UTF-8.
                    if (cp >= 0xD800 && cp <= 0xDFFF) cp = '?';
                    putUtf8(out, cp);
                    break;
                }
                default: return fail("bad escape");
            }
        }
        if (p >= end) return fail("unterminated string");
        p++;
        return true;
    }

    // Skip any value (used for nested objects/arrays). Depth-limited so a hostile file can't
    // recurse the stack away.
    bool skip(int depth = 0) {
        if (depth > 16) return fail("nested too deep");
        ws();
        if (p >= end) return fail("unexpected end");
        char c = *p;
        if (c == '"') { String s; return str(s); }
        if (c == '{' || c == '[') {
            const char close = c == '{' ? '}' : ']';
            p++; ws();
            if (p < end && *p == close) { p++; return true; }
            for (;;) {
                if (c == '{') { String k; ws(); if (!str(k)) return false; ws();
                                if (p >= end || *p != ':') return fail("expected ':'"); p++; }
                if (!skip(depth + 1)) return false;
                ws();
                if (p < end && *p == ',') { p++; continue; }
                if (p < end && *p == close) { p++; return true; }
                return fail("expected ',' or a closing bracket");
            }
        }
        String t; return scalar(t);
    }

    // number / true / false / null, as written
    bool scalar(String& out) {
        const char* s = p;
        while (p < end && (isalnum((unsigned char)*p) || *p == '-' || *p == '+' || *p == '.')) p++;
        if (p == s) return fail("unexpected character");
        out = String();
        out.concat(s, (unsigned)(p - s));
        return true;
    }
};

} // namespace

bool eachMember(const char* json, size_t len, const std::function<bool(const Member&)>& fn, String& err) {
    Reader r{json, json + len, String()};
    r.ws();
    if (r.p >= r.end || *r.p != '{') { err = "not a JSON object"; return false; }
    r.p++; r.ws();
    bool stopped = false;
    if (r.p < r.end && *r.p == '}') r.p++;
    else for (;;) {
        Member m;
        r.ws();
        if (!r.str(m.key)) { err = r.err; return false; }
        r.ws();
        if (r.p >= r.end || *r.p != ':') { err = "expected ':'"; return false; }
        r.p++; r.ws();
        if (r.p >= r.end) { err = "unexpected end"; return false; }
        const char c = *r.p;
        m.raw = r.p; m.rawLen = 0;
        if (c == '"')                  { m.kind = Kind::String; if (!r.str(m.text)) { err = r.err; return false; } }
        else if (c == '{' || c == '[') { m.kind = c == '{' ? Kind::Object : Kind::Array;
                                         if (!r.skip()) { err = r.err; return false; }
                                         m.rawLen = r.p - m.raw; }
        else {
            if (!r.scalar(m.text)) { err = r.err; return false; }
            if (m.text == "true" || m.text == "false") m.kind = Kind::Bool;
            else if (m.text == "null")                 m.kind = Kind::Null;
            else {
                // Integers only: every number in the config is one.
                const char* s = m.text.c_str(); if (*s == '-') s++;
                if (!*s) { err = "bad number"; return false; }
                for (; *s; s++) if (*s < '0' || *s > '9') { err = String("not an integer: ") + m.text; return false; }
                m.kind = Kind::Number;
            }
        }
        if (!stopped && !fn(m)) stopped = true;   // keep parsing so a broken tail is still reported
        r.ws();
        if (r.p < r.end && *r.p == ',') { r.p++; continue; }
        if (r.p < r.end && *r.p == '}') { r.p++; break; }
        err = "expected ',' or '}'"; return false;
    }
    r.ws();
    if (r.p != r.end) { err = "trailing data after the object"; return false; }
    return true;
}

String quote(const String& s) {
    String o; o.reserve(s.length() + 2);
    o += '"';
    for (size_t i = 0; i < s.length(); i++) {
        const char c = s[i];
        if (c == '"' || c == '\\') { o += '\\'; o += c; }
        else if ((uint8_t)c < 0x20) { char b[8]; snprintf(b, sizeof(b), "\\u%04x", (unsigned)(uint8_t)c); o += b; }
        else o += c;
    }
    o += '"';
    return o;
}

} // namespace cfgjson
