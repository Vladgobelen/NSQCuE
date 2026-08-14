#!/bin/bash

OUTPUT="output.txt"
ROOT="/home/diver/sources/JS/NSQCuE"

> "$OUTPUT"

# 1. Структура только указанных папок
echo "📁 STRUCTURE" >> "$OUTPUT"
echo "────────────────────────────────────────" >> "$OUTPUT"

for dir in ".github" "main" "renderer"; do
    if [[ -d "$ROOT/$dir" ]]; then
        echo "$dir/" >> "$OUTPUT"
        find "$ROOT/$dir" -type f | sed "s|$ROOT/$dir/|  |" | sort >> "$OUTPUT"
    fi
done

echo "" >> "$OUTPUT"

# 2. package.json
if [[ -f "$ROOT/package.json" ]]; then
    echo "════════════════════════════════════════" >> "$OUTPUT"
    echo "📄 FILE: package.json" >> "$OUTPUT"
    echo "════════════════════════════════════════" >> "$OUTPUT"
    cat "$ROOT/package.json" >> "$OUTPUT"
    echo "" >> "$OUTPUT"
fi

# 3. Содержимое файлов из указанных папок
for dir in ".github" "main" "renderer"; do
    if [[ -d "$ROOT/$dir" ]]; then
        find "$ROOT/$dir" -type f | sort | while read -r file; do
            echo "════════════════════════════════════════" >> "$OUTPUT"
            echo "📄 FILE: ${file#$ROOT/}" >> "$OUTPUT"
            echo "════════════════════════════════════════" >> "$OUTPUT"
            cat "$file" >> "$OUTPUT"
            echo "" >> "$OUTPUT"
        done
    fi
done

echo "✅ Готово: $OUTPUT"