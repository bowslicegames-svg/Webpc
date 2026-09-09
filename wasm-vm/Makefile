EMCC ?= emcc
SRC = src/main.c
OUT_DIR = build
OUT_JS = $(OUT_DIR)/tinyemu.js
OUT_WASM = $(OUT_DIR)/tinyemu.wasm

CFLAGS = -O2

all: $(OUT_JS)

$(OUT_JS): $(SRC)
    mkdir -p $(OUT_DIR)
    $(EMCC) $(SRC) -o $(OUT_JS) \
      -O2 \
      -s WASM=1 \
      -s MODULARIZE=1 \
      -s EXPORT_NAME="TinyEmuModule" \
      -s ALLOW_MEMORY_GROWTH=1 \
      -s ENVIRONMENT='web' \
      -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]'

clean:
    rm -rf $(OUT_DIR)
