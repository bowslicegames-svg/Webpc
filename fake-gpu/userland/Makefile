CC = gcc
CFLAGS = -O2
SRC = fakegpu.c
OUT = fakegpu_writer

all: $(OUT)

$(OUT): $(SRC)
    $(CC) $(CFLAGS) -o $(OUT) $(SRC)

clean:
    rm -f $(OUT) fakegpu_frame.bin
