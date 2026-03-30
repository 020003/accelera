---
description: Full quality audit using superpowers + everything-claude-code + ui-ux-pro-max methodology
---

# Quality Audit Workflow

Run this before any major release or PR merge.

## 1. UI/UX Pre-Delivery Checklist (ui-ux-pro-max)

- [ ] No emojis used as icons — use Lucide SVG icons only
- [ ] `cursor-pointer` on ALL clickable elements (buttons, links, tabs, toggles)
- [ ] Hover states with smooth transitions (150–300ms)
- [ ] Light mode: text contrast ≥ 4.5:1 (WCAG AA)
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected for animations
- [ ] Responsive tested at: 375px, 768px, 1024px, 1440px
- [ ] All charts use CSS variable colors, not hardcoded hex/rgba
- [ ] Every page has loading, empty, and error states
- [ ] Labels are dynamic (no hardcoded time ranges, counts, etc.)
- [ ] Semantic status colors: green=ok, amber=warning, red=critical
- [ ] Consistent spacing between cards and sections

## 2. Coding Standards (everything-claude-code)

- [ ] No file exceeds 800 lines
- [ ] No function exceeds 50 lines
- [ ] No nesting deeper than 4 levels
- [ ] No hardcoded values — use constants or config
- [ ] Explicit error handling at every level (no silent swallows)
- [ ] Input validation at system boundaries
- [ ] Immutable data patterns (no in-place mutation of shared state)
- [ ] No unused imports or dead code

## 3. Security (everything-claude-code)

- [ ] No hardcoded secrets (API keys, passwords, tokens) in source
- [ ] All SQL uses parameterized queries (no string interpolation)
- [ ] HTML output sanitized (no XSS vectors)
- [ ] Error messages don't leak internal paths or stack traces to clients
- [ ] Environment variables for all configuration secrets
- [ ] CORS properly configured (not wildcard in production)
- [ ] Rate limiting on public endpoints

## 4. Systematic Debugging (superpowers)

When fixing bugs, always follow 4 phases:
1. **Root Cause Investigation** — reproduce, gather evidence, check logs
2. **Pattern Analysis** — search for similar issues in codebase
3. **Hypothesis & Testing** — form hypothesis, test with minimal change
4. **Implementation** — fix at root cause, not downstream workaround

## 5. Verification Before Completion (superpowers — IRON LAW)

**NO completion claims without fresh verification evidence.**

// turbo
```bash
# Frontend build verification
docker compose build frontend 2>&1 | tail -5
```

// turbo
```bash
# Backend syntax check
python3 -m py_compile server/app.py && python3 -m py_compile server/storage.py && echo "Python OK"
```

// turbo
```bash
# Health check all GPU hosts
for host in 10.2.15.99 10.2.63.234 10.2.3.31; do
  curl -sf "http://$host:5000/health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'$host: {d[\"status\"]}')" 2>/dev/null || echo "$host: FAIL"
done
```

// turbo
```bash
# Check for hardcoded secrets
grep -rn "password\|api_key\|secret" server/ --include="*.py" | grep -v "\.pyc" | grep -v "config.py" | grep -v "#"
```

// turbo
```bash
# Check git status is clean
git status --short
```

Run ALL commands above. Read ALL output. THEN claim status.
