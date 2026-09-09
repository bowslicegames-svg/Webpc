CC = gcc
CFLAGS = -O2
SRC = src/tinyemu_stub.c
OUT = tinyemu_stub

all: $(OUT)

$(OUT): $(SRC)
    $(CC) $(CFLAGS) -o $(OUT) $(SRC)

clean:
    rm -f $(OUT)
