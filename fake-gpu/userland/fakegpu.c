#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/*
 * fakegpu.c
 * Minimal userland program that writes a "frame" into a file that the browser
 * renderer can read (in a real system this would be shared memory / ring buffer).
 */

int main(int argc, char** argv) {
    const char *out = "fakegpu_frame.bin";
    FILE *f = fopen(out, "wb");
    if (!f) {
        perror("fopen");
        return 1;
    }
    const char *msg = "FRAME: placeholder pixel data\n";
    fwrite(msg, 1, strlen(msg), f);
    fclose(f);
    printf("Wrote placeholder frame to %s\n", out);
    return 0;
}
