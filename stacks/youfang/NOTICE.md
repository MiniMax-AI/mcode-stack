# Third-party notices

## handdrawn-diagram

[`skills/magic-move-deck/styles/handdrawn/diagram.html`](skills/magic-move-deck/styles/handdrawn/diagram.html)
is adapted from the template in
[TrentChou/handdrawn-diagram](https://github.com/TrentChou/handdrawn-diagram):
its palette, typography, shape helpers and `main()` contract. The other three
style templates follow the same helper API. Changes for this stack: a 1920×1080
default canvas, a card palette (`C.card`) and a `glow` entry used by the deck
engine.

```
MIT License

Copyright (c) 2026 TrentChou

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Loaded at run time, not bundled

- [rough.js](https://roughjs.com) 4.6.6 (MIT), loaded from jsDelivr when a
  diagram is rendered. Built decks contain the SVG it produced, not the
  library.
- [Noto Serif SC](https://fonts.google.com/noto/specimen/Noto+Serif+SC)
  (SIL Open Font License 1.1), loaded from Google Fonts by the hand-drawn
  template as a fallback when no Songti font is installed.
- [Playwright](https://playwright.dev) (Apache-2.0) and ffmpeg run the build,
  screenshot and video scripts; they are installed by the user.

Everything else in this stack is released under the repository's
[MIT License](../../LICENSE).
