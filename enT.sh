#!/bin/bash

# Имя выходного файла
OUTPUT="output.txt"

# Очистка или создание выходного файла
> "$OUTPUT"

# Поиск всех .js и .css файлов (рекурсивно), сортировка по имени
find . -type f \( -name "*.js" -o -name "*.css" \) -print0 | \
  sort -z | \
  while IFS= read -r -d '' file; do
    # Убираем префикс ./ из имени файла (делаем относительный путь красивым)
    filename="${file#./}"
    
    # Выводим заголовок и содержимое файла
    {
      echo "$filename:"
      cat "$file"
      echo  # пустая строка
      echo  # ещё одна пустая строка для разделения
    } >> "$OUTPUT"
  done

echo "Готово! Все файлы .js и .css собраны в $OUTPUT"