#!/bin/bash
cd ~/projects/apps/docs
sed -i 's/adapter: "vercel"/adapter: "node"/g' blume.config.ts
grep -E 'title:|defaultLocale:|adapter:|output:' blume.config.ts
