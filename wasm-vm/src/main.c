#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

int main(int argc, char** argv) {
    printf("TinyEMU WASM demo: booting minimal VM\\n");
    printf("Initializing console...\\n");

    for (int i = 0; i < 5; ++i) {
        printf("Boot step %d/5\\n", i+1);
        fflush(stdout);
        // simple delay loop to simulate work
        volatile unsigned long t = 0;
        for (unsigned long j = 0; j < 20000000UL; ++j) t += j;
    }

    printf("TinyEMU WASM demo: VM ready.\\n");
    printf("You can replace this program with a real emulator core.\\n");

    // Keep process alive so the module does not immediately exit when used interactively
    // Emscripten will return to JS after main returns. For demo we return.
    return 0;
}
