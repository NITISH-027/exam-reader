"""Optional browser tests for explicit consent, safe output and offline fallback.
Provider responses are mocked. No Gemini key or billable call is used.
"""
import argparse
import asyncio
import pathlib
import subprocess
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent


async def run(browser_path, base_url):
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
        context = await browser.new_context(viewport={'width':1429,'height':960})
        page = await context.new_page()
        errors, requests, google_requests = [], [], []
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('request',lambda request:google_requests.append(request.url) if 'googleapis.com' in request.url else None)
        await page.goto(base_url)
        await page.click('text=Try it now')
        await page.click('#sampleBtn')
        await page.click('#startBtn')
        await page.locator('.ai-assist summary').click()
        check('AI is opt-in, disabled initially', await page.locator('#simplifyBtn').is_disabled())
        check('consent unchecked initially', not await page.locator('#aiConsent').is_checked())
        await page.click('#localAidBtn')
        check('local guide requires no consent or upload', 'Local reading guide' in await page.locator('#aiResultTitle').inner_text() and requests==[])
        check('privacy explanation names Google', 'Google Gemini' in await page.locator('.ai-privacy').inner_text())
        original = await page.locator('#paper').inner_text()
        marks = await page.locator('#qcardTop').inner_text()
        async def success(route):
            requests.append(route.request.post_data_json)
            await route.fulfill(json={'source':'gemini','text':'Mock test rewording. <img src=x onerror=alert(1)>'})
        await page.route('**/api/simplify',success)
        await page.check('#aiConsent')
        check('consent alone sends nothing', requests == [])
        await page.click('#simplifyBtn')
        await page.locator('#aiResult:not(.hidden)').wait_for()
        check('explicit click sends one request', len(requests)==1)
        check('only question and profile fields sent', sorted(requests[0].keys())==['profile','question'])
        check('only selected question sent', 'What is the process' in requests[0]['question'] and 'train travels' not in requests[0]['question'])
        check('original words unchanged', await page.locator('#paper').inner_text()==original)
        check('original marks unchanged', await page.locator('#qcardTop').inner_text()==marks)
        check('AI result clearly labelled', 'Gemini AI rewording' in await page.locator('#aiResultTitle').inner_text())
        check('AI markup remains inert text', await page.locator('#aiResult img').count()==0)
        await page.click('#simplifyBtn')
        check('repeated click uses memory cache',len(requests)==1)
        await page.keyboard.press('ArrowRight')
        check('new question resets consent',not await page.locator('#aiConsent').is_checked())
        check('old result hidden on new question',not await page.locator('#aiResult').is_visible())
        await page.unroute('**/api/simplify')
        await page.route('**/api/simplify',lambda route:route.abort())
        await page.check('#aiConsent')
        await page.click('#simplifyBtn')
        await page.locator('#aiResult:not(.hidden)').wait_for()
        check('network failure has deterministic fallback','Local reading guide' in await page.locator('#aiResultTitle').inner_text())
        await page.keyboard.press('ArrowRight')
        await context.set_offline(True)
        await page.check('#aiConsent')
        await page.click('#simplifyBtn')
        check('offline UI still produces local guide','Local reading guide' in await page.locator('#aiResultTitle').inner_text())
        await context.set_offline(False)
        await page.unroute('**/api/simplify')
        await page.keyboard.press('ArrowRight')
        await page.check('#aiConsent')
        await page.click('#simplifyBtn')
        await page.locator('#aiResult:not(.hidden)').wait_for()
        check('actual server without key falls back safely','Local reading guide' in await page.locator('#aiResultTitle').inner_text())
        check('browser never contacts Google directly', google_requests==[])
        check('no JavaScript errors',errors==[])
        local = await context.new_page()
        await local.goto((ROOT/'index.html').as_uri())
        await local.click('text=Try it now')
        await local.click('#sampleBtn')
        await local.click('#startBtn')
        await local.locator('.ai-assist summary').click()
        await local.check('#aiConsent')
        await local.click('#simplifyBtn')
        check('downloaded file has local fallback','Local reading guide' in await local.locator('#aiResultTitle').inner_text())
        await browser.close()
        print(f'\n{passed} AI browser checks passed, 0 failed')


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--browser')
    args=parser.parse_args()
    # Force missing-key mode regardless of a developer's local environment.
    script="const {createApp}=require('./server.js');const {createSimplifier}=require('./ai-service.js');const server=createApp({simplify:createSimplifier({apiKey:''})});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));"
    process=subprocess.Popen(['node','-e',script],cwd=ROOT,stdout=subprocess.PIPE,text=True)
    try:
        port=int(process.stdout.readline().strip())
        asyncio.run(run(args.browser,'http://127.0.0.1:'+str(port)))
    finally:
        process.terminate()
        process.wait(timeout=10)


if __name__=='__main__':
    main()
