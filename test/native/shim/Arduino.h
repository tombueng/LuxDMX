// Minimal Arduino shim — JUST enough of String/Print for the config engine to
// compile and run natively under MSVC. Not used in the firmware build (there
// <Arduino.h> resolves to the real framework header).
#pragma once
#include <string>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cstdio>

class String {
    std::string s;
public:
    String() {}
    String(const char* c) { if (c) s = c; }
    String(const std::string& x) : s(x) {}
    String(int v) { char b[16]; snprintf(b, sizeof(b), "%d", v); s = b; }
    const char* c_str() const { return s.c_str(); }
    size_t length() const { return s.size(); }
    void reserve(size_t) {}
    const std::string& str() const { return s; }
    String& operator=(const String& o) { s = o.s; return *this; }
    String& operator+=(const String& o) { s += o.s; return *this; }
    String operator+(const String& o) const { return String(s + o.s); }
    String operator+(const char* o) const { return String(s + (o ? o : "")); }
    String operator+(int v) const { char b[16]; snprintf(b, sizeof(b), "%d", v); return String(s + b); }
    bool operator==(const char* o) const { return o && s == o; }
    bool operator==(const String& o) const { return s == o.s; }
    char operator[](size_t i) const { return i < s.size() ? s[i] : 0; }
};
inline String operator+(const char* a, const String& b) { return String(std::string(a ? a : "") + b.str()); }

#define constrain(x, lo, hi) ((x) < (lo) ? (lo) : ((x) > (hi) ? (hi) : (x)))

class Print {
public:
    virtual ~Print() {}
    virtual void print(const char* c) = 0;
    void print(const String& v) { print(v.c_str()); }
    void print(int v) { char b[16]; snprintf(b, sizeof(b), "%d", v); print(b); }
};
