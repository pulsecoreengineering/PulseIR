/** Host stub of the LiquidCrystal_I2C library — just enough surface to compile. */
#ifndef PULSE_TEST_LIQUIDCRYSTAL_I2C_H
#define PULSE_TEST_LIQUIDCRYSTAL_I2C_H
class LiquidCrystal_I2C {
public:
  LiquidCrystal_I2C(int addr, int cols, int rows) { (void)addr; (void)cols; (void)rows; }
  void init() {}
  void backlight() {}
  void setCursor(int col, int row) { (void)col; (void)row; }
  void print(const char* s) { (void)s; }
  void print(float v) { (void)v; }
  void clear() {}
};
#endif
