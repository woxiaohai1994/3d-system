/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "native-boundaries.hh"
#include "ED_numinput.hh"

#include <iomanip>
#include <iostream>
#include <sstream>
#include <type_traits>

static std::string decode_hex(const std::string &hex)
{
  if (hex == "-") { return ""; }
  std::string result;
  for (size_t i = 0; i < hex.size(); i += 2) {
    result += char(std::stoi(hex.substr(i, 2), nullptr, 16));
  }
  return result;
}
static void json_string(const std::string &value)
{
  std::cout << '"';
  for (const unsigned char ch : value) {
    if (ch == '"' || ch == '\\') { std::cout << '\\' << ch; }
    else if (ch < 32) {
      std::cout << "\\u" << std::hex << std::setw(4) << std::setfill('0') << int(ch)
                << std::dec << std::setfill(' ');
    }
    else { std::cout << ch; }
  }
  std::cout << '"';
}
template<typename T> static void array3(const T *values)
{
  std::cout << '[';
  for (int i = 0; i < 3; ++i) {
    if (i) std::cout << ',';
    if constexpr (std::is_floating_point_v<T>) {
      if (values[i] == 0 && std::signbit(values[i])) { std::cout << "-0.0"; continue; }
    }
    std::cout << values[i];
  }
  std::cout << ']';
}
static void snapshot(NumInput &n, const float *result, bool handled, bool applied)
{
  std::cout << "{\"handled\":" << handled << ",\"idx\":" << n.idx
            << ",\"idx_max\":" << n.idx_max << ",\"str\":";
  json_string(n.str);
  std::cout << ",\"str_cur\":" << n.str_cur << ",\"flag\":" << n.flag << ",\"val_flag\":";
  array3(n.val_flag);
  std::cout << ",\"val\":"; array3(n.val);
  std::cout << ",\"val_org\":"; array3(n.val_org);
  std::cout << ",\"result\":"; array3(result);
  std::cout << ",\"applied\":" << applied << ",\"hasInput\":" << hasNumInput(&n) << "}\n";
}
int main()
{
  // Seventeen digits preserve the exact promoted float value when JSON is read as a JS number.
  std::cout << std::boolalpha << std::setprecision(17);
  std::string operation;
  bContext context;
  NumInput n;
  float initial[3] = {0, 0, 0};
  while (std::cin >> operation) {
    if (operation == "INIT") {
      std::string kind;
      int idx_max, affect_all, null_one;
      std::cin >> kind >> idx_max >> affect_all >> null_one >> initial[0] >> initial[1] >> initial[2];
      initNumInput(&n);
      n.idx_max = idx_max;
      if (affect_all) { n.flag |= NUM_AFFECT_ALL; }
      for (int i = 0; i < NUM_MAX_ELEMENTS; ++i) {
        if (null_one) { n.val_flag[i] |= NUM_NULL_ONE; }
        n.unit_type[i] = kind == "rotate" ? B_UNIT_ROTATION :
                         kind == "translate" ? B_UNIT_LENGTH : B_UNIT_NONE;
      }
      float result[3]; copy_v3_v3(result, initial);
      const bool applied = applyNumInput(&n, result);
      snapshot(n, result, false, applied);
    }
    else if (operation == "EVENT") {
      int type, modifiers;
      std::string utf8_hex;
      std::cin >> type >> modifiers >> utf8_hex;
      wmEvent event{};
      event.type = type;
      event.modifier = modifiers;
      const std::string utf8 = decode_hex(utf8_hex);
      BLI_strncpy(event.utf8_buf, utf8.c_str(), sizeof(event.utf8_buf));
      const bool handled = handleNumInput(&context, &n, &event);
      float result[3]; copy_v3_v3(result, initial);
      const bool applied = applyNumInput(&n, result);
      snapshot(n, result, handled, applied);
    }
    else if (operation == "FORMAT") {
      std::string input;
      int rotation, precision;
      std::cin >> input >> rotation >> precision;
      const double value = std::strtod(input.c_str(), nullptr);
      char str[NUM_STR_REP_LEN];
      const size_t length = BKE_unit_value_as_string_adaptive(str, sizeof(str), value, precision,
                                                             USER_UNIT_NONE, rotation ? B_UNIT_ROTATION : B_UNIT_NONE,
                                                             true, false);
      std::cout << "{\"result\":"; json_string(str);
      std::cout << ",\"length\":" << length << "}\n";
    }
    else { std::cerr << "Unknown operation: " << operation << '\n'; return 2; }
  }
}
