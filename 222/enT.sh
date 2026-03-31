#!/bin/bash

# === Конфигурация ===
OUTPUT_FILE="output.txt"

# === Жёсткий список файлов проекта ===
FILES=(
    "main/main.js"
    "main/preload.js"
    "main/addonManager.js"
    "main/settings.js"
    "main/utils.js"
    "renderer/index.html"
    "renderer/renderer.js"
    "renderer/style.css"
    "renderer/voice-chat-local.js"
    "renderer/voice-chat-local.html"
    "js/mediasoupClient.js"
    "global-mouse-hook/index.js"
    "index.js"
    "package.json"
)

# === Очистка выходного файла ===
> "$OUTPUT_FILE"
echo "=== Project Files Export ===" >> "$OUTPUT_FILE"
echo "Generated: $(date)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# === Запись файлов ===
echo "Exporting files..."

file_count=0
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "=== FILE: $file ===" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        cat "$file" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        echo "" >> "$OUTPUT_FILE"
        ((file_count++))
        echo "  Added: $file"
    else
        echo "  Warning: File not found: $file"
    fi
done

# === Итог ===
echo "" >> "$OUTPUT_FILE"
echo "=== End of Export ===" >> "$OUTPUT_FILE"

echo ""
echo "================================"
echo "Export complete!"
echo "Total files: $file_count"
echo "Output file: $OUTPUT_FILE"
echo "================================"