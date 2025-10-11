#!/bin/sh
cd "/home/diver/sources/JS/NSQCuE/"
j=$(date)
git add .
git commit -m "$1 $j"
git push git@github.com:Vladgobelen/NSQCuE.git

