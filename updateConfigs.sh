#!/bin/sh

cd "/home/diver/sources/JS/delE1/" || exit 1

branch=$(git branch --show-current)
[ -n "$branch" ] || { echo "Не определена ветка"; exit 1; }

echo "Текущая ветка: $branch"

# Добавляем все изменения
git add .

# Проверяем, отличается ли индекс от HEAD
if ! git diff-index --quiet --cached HEAD --; then
  j=$(date)
  git commit -m "$1 $j"
else
  echo "Нет изменений для коммита."
fi

# Синхронизируем с origin
git pull --rebase origin "$branch"

# Пушим
git push origin "$branch"