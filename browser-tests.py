"""Optional end-to-end tests. Requires Playwright, never a running backend.
Run: python browser-tests.py
Use --browser PATH when an existing Chromium/Chrome binary is preferred.
"""
import argparse
import asyncio
import functools
import http.server
import pathlib
import threading
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


async def run(browser_path, port):
    passed = 0

    def check(name, condition):
        nonlocal passed
        assert condition, name
        passed += 1
        print('PASS ' + name)

    async with async_playwright() as playwright:
        options = {'headless': True}
        if browser_path:
            options['executable_path'] = browser_path
        browser = await playwright.chromium.launch(**options)
        context = await browser.new_context(viewport={'width': 1429, 'height': 960})
        # Deterministic test of the no-local-voice path on every machine.
        await context.add_init_script("speechSynthesis.getVoices = () => [];")
        page = await context.new_page()
        errors, external = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: external.append(request.url)
                if not request.url.startswith(f'http://127.0.0.1:{port}/') else None)
        await page.goto(f'http://127.0.0.1:{port}/')
        check('landing visible', await page.locator('#view-landing').is_visible())
        await page.click('text=Try it now')
        check('paste visible', await page.locator('#src').is_visible())
        check('skip target follows the screen', await page.locator('#skipLink').get_attribute('href') == '#main-paste')
        original_theme = await page.evaluate('getComputedStyle(document.body).backgroundImage')
        await page.click('#sampleBtn')
        await page.click('[data-profile="dyslexia"]')
        check('selected chip announced', await page.locator('[data-profile="dyslexia"]').get_attribute('aria-pressed') == 'true')
        check('selected heading visible', 'Selected: Dyslexia' in await page.locator('#whyHead').inner_text())
        check('lilac theme unchanged', original_theme == await page.evaluate('getComputedStyle(document.body).backgroundImage'))
        await page.click('#startBtn')
        check('six sample questions', await page.locator('#qPos').inner_text() == 'Question 1 of 6')
        check('cream limited to card', await page.locator('#qcard').evaluate("e=>e.style.background==='rgb(253, 246, 227)'"))
        check('chunk separators rendered', await page.locator('#paper .chunk').count() > 0)
        check('chunk separators hidden from assistive reading', await page.locator('#paper .chunk').first.get_attribute('aria-hidden') == 'true')
        await page.wait_for_timeout(450)
        check('voice fallback explained', 'Follow-along' in await page.locator('#voiceNote').inner_text())
        check('one word highlighted', await page.locator('.w.said').count() == 1)
        await page.click('#playBtn')
        check('speech stops cleanly', await page.locator('.w.said').count() == 0)
        await page.keyboard.press('ArrowRight')
        check('right arrow advances', await page.locator('#qPos').inner_text() == 'Question 2 of 6')
        await page.click('#bkBtn')
        check('bookmark state exposed', await page.locator('#bkBtn').get_attribute('aria-pressed') == 'true')
        await page.click('[data-rail="contrast"]')
        check('popover keyboard focus enters', await page.locator('#pop button').first.evaluate('e=>e===document.activeElement'))
        await page.keyboard.press('Escape')
        check('Escape returns focus', await page.locator('[data-rail="contrast"]').evaluate('e=>e===document.activeElement'))
        await page.click('[data-rail="spotlight"]')
        check('spotlight pressed state updated', await page.locator('[data-rail="spotlight"]').get_attribute('aria-pressed') == 'false')
        await page.click('[data-rail="settings"]')
        await page.get_by_role('switch', name='Focus ruler (list view)').click()
        await page.keyboard.press('Escape')
        await page.keyboard.press('Alt+ArrowDown')
        check('keyboard ruler works', await page.locator('#rulerBand').evaluate("e=>parseFloat(e.style.top)>0"))
        await page.click('#view-reader [data-go="paste"]')
        await page.click('[data-profile="none"]')
        await page.fill('#src', '1. <img src=x onerror="window.injected=true"> [2 marks]')
        await page.wait_for_timeout(100)
        await page.click('#startBtn')
        check('pasted markup is inert text', await page.locator('#paper img,#paper script').count() == 0)
        check('pasted words retained', '<img' in await page.locator('#paper').inner_text())
        check('no pasted script ran', await page.evaluate('window.injected !== true'))
        await page.click('#view-reader [data-go="paste"]')
        await page.fill('#src', 'x' * 50001)
        await page.wait_for_timeout(150)
        check('oversized input blocks reading', await page.locator('#startBtn').is_disabled())
        check('input limit explained', '50,000' in await page.locator('#inputError').inner_text())
        check('input not silently truncated', len(await page.locator('#src').input_value()) == 50001)
        await page.fill('#src', '1.')
        await page.wait_for_timeout(100)
        await page.click('#startBtn')
        check('empty numbered paper handled', 'Add text' in await page.locator('#inputError').inner_text())
        await page.click('#clearBtn')
        await page.wait_for_timeout(100)
        check('clear hides reading button', not await page.locator('#startBtn').is_visible())
        await page.evaluate("localStorage.setItem('examreader', JSON.stringify({profile:'toString',size:999,contrast:'invalid'}))")
        await page.reload()
        await page.click('text=Try it now')
        check('invalid saved settings rejected', await page.locator('#sizeLabel').inner_text() == '100%')
        for profile in ['lowvision', 'focus', 'esl', 'time']:
            await page.click('[data-profile="' + profile + '"]')
            check('profile can be selected: ' + profile, await page.locator('[data-profile="' + profile + '"]').get_attribute('aria-pressed') == 'true')
        await page.click('[data-c="none"]')
        await page.set_viewport_size({'width': 390, 'height': 844})
        check('mobile has no page overflow', await page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        await page.click('#sampleBtn')
        await page.click('#startBtn')
        check('mobile reader has no page overflow', await page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        check('mobile settings control reachable', await page.locator('[data-rail="settings"]').is_visible())
        await page.emulate_media(reduced_motion='reduce')
        check('reduced-motion CSS active', await page.locator('body').evaluate("e=>parseFloat(getComputedStyle(e).transitionDuration)<0.01"))
        check('no external network requests', external == [])
        check('no JavaScript errors', errors == [])
        await browser.close()
        print(f'\n{passed} browser checks passed, 0 failed')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser')
    args = parser.parse_args()
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            asyncio.run(run(args.browser, server.server_port))
        finally:
            server.shutdown()


if __name__ == '__main__':
    main()
