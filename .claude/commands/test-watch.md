---
description: Run tests in watch mode for development
---

Run integration tests in watch mode - tests re-run automatically when files change:

```bash
npm run test:watch
```

**Prerequisites:**
- Server must be running: `npm run dev`

**Features:**
- Automatically re-runs tests when source files change
- Interactive mode for filtering tests
- Great for TDD workflow

**Keyboard shortcuts in watch mode:**
- `a` - Run all tests
- `f` - Run only failed tests
- `p` - Filter by filename pattern
- `t` - Filter by test name pattern
- `q` - Quit watch mode

Use this during active development for continuous feedback.
