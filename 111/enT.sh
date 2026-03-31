#!/bin/bash

# Имя выходного файла
OUTPUT="output.txt"

# Очистка или создание выходного файла
> "$OUTPUT"

# Поиск всех файлов рекурсивно, сортировка по имени
find . -type f -print0 | \
  sort -z | \
  while IFS= read -r -d '' file; do
    # Определяем тип файла по содержимому
    filetype=$(file -b "$file")
    
    # Пропускаем бинарные файлы и пустые (оставляем только текстовые)
    # Фильтр: тип файла должен содержать "text" (регистронезависимо)
    if ! echo "$filetype" | grep -qi 'text'; then
      continue
    fi
    
    # Убираем префикс ./ из имени файла
    filename="${file#./}"
    
    # Выводим заголовок и содержимое файла
    {
      echo "$filename:"
      echo "Тип: $filetype"
      echo "---"
      cat "$file"
      echo  # пустая строка
      echo  # ещё одна пустая строка для разделения
    } >> "$OUTPUT"
  done

echo "Готово! Все текстовые файлы собраны в $OUTPUT"