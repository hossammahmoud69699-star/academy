#!/usr/bin/env bash
# يفعّل البناء التلقائي على GitHub ثم يرفع المشروع. شغّله من داخل Codespaces.
set -e
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

mkdir -p .github/workflows
cp academy-platform/ci/build.yml .github/workflows/build.yml

cat > .gitignore <<'EOF'
node_modules/
dist/
build/
.gradle/
local.properties
.env
*.zip
EOF

# إزالة ما قد يكون أُضيف سابقًا ولا يجب رفعه
git rm -r -q --cached --ignore-unmatch academy-platform/server/node_modules academy-platform.zip academy-platform/.env 2>/dev/null || true

git add -A
git commit -m "المرحلة 3: تطبيق Android وبناء تلقائي" || echo "لا تغييرات جديدة"
git push
echo "تم الرفع. افتح تبويب Actions في المستودع على GitHub لمتابعة البناء."
