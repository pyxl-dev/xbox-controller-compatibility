CFLAGS = -O2 -Wall -Wextra -arch arm64 -mmacosx-version-min=27.0
LIBS = -framework CoreFoundation -framework IOKit

all: padbridge.dylib padbridge-test

padbridge.dylib: padbridge.c
	clang $(CFLAGS) -dynamiclib -o $@ $< $(LIBS)
	codesign -s - -f $@

padbridge-test: padbridge.c
	clang $(CFLAGS) -DPADBRIDGE_STANDALONE -o $@ $< $(LIBS)

clean:
	rm -f padbridge.dylib padbridge-test

.PHONY: all clean
