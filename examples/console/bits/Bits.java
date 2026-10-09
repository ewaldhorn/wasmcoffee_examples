public void main() {
    int a = 0b00111100; // 60
    int b = 0b00001101; // 13

    // Bitwise operators
    IO.println("a & b: " + (a & b));
    IO.println("a | b: " + (a | b));
    IO.println("a ^ b: " + (a ^ b));
    IO.println("~a: " + ~a);
    IO.println("a << 2: " + (a << 2));
    IO.println("a >> 2: " + (a >> 2));

    // Bit manipulation intrinsics
    IO.println("bitCount: " + Integer.bitCount(a));
    IO.println("leadingZeros: " + Integer.numberOfLeadingZeros(a));
    IO.println("trailingZeros: " + Integer.numberOfTrailingZeros(a));

    // Bit flags: set, check, clear
    int flags = 0;
    int readFlag = 1 << 0; // bit 0 (1)
    int writeFlag = 1 << 1; // bit 1 (2)

    flags |= readFlag | writeFlag; // set read and write
    IO.println("has read: " + ((flags & readFlag) != 0));

    flags &= ~writeFlag; // clear write
    IO.println("has write: " + ((flags & writeFlag) != 0));
}
