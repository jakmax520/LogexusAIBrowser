import asyncio, websockets, json, time, sys

async def test():
    token = 'lx_3696ac533d9ddfb81d5e50340f205317'
    passed = 0
    failed = 0

    async with websockets.connect(
        f'ws://127.0.0.1:9527?token={token}&role=agent&clientId=jd_full'
    ) as ws:

        # Step 1: Navigate to jd.com (SW-level, auto-wait for load + CS ready)
        print('Step 1: Navigate to jd.com (SW-level)...')
        await ws.send(json.dumps({
            'jsonrpc': '2.0', 'method': 'browser.navigate',
            'params': {'url': 'https://www.jd.com'}, 'id': 'nav'
        }))
        resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=60))
        if 'result' in resp:
            url = resp['result']['url']
            elems = resp['result']['elements']
            print(f'  PASS  url={url[:60]}  elements={len(elems)}')
            passed += 1
        else:
            print('  FAIL  ' + json.dumps(resp.get('error', {}), ensure_ascii=False)[:120])
            failed += 1
            return

        # Check: jd.com might redirect to corporate.jd.com
        if 'corporate' in url:
            print('  (redirected to corporate site, going directly to search)')
            await ws.send(json.dumps({
                'jsonrpc': '2.0', 'method': 'browser.navigate',
                'params': {'url': 'https://search.jd.com/Search?keyword=%E6%89%8B%E6%9C%BA&enc=utf-8'},
                'id': 'nav2'
            }))
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=60))
            url = resp['result']['url']
            elems = resp['result']['elements']
            print(f'  direct search: url={url[:60]}  elements={len(elems)}')

            # Show results
            print('\n  === Search Results (from direct URL) ===')
            count = 0
            for e in elems:
                txt = e.get('text', '')
                if len(txt) > 12 and e.get('inViewport'):
                    print(f'  [{e["id"]}] <{e["tag"]}> "{txt[:80]}"')
                    count += 1
                    if count >= 10:
                        break
            if count == 0:
                print('  (no visible results — likely JS-rendered)')
            print(f'\n=== {passed}/{passed+failed} passed ===')
            return

        # Step 2: Find search input in visible elements
        print('\nStep 2: Find search input...')
        visible = [e for e in elems if e.get('inViewport')]
        inputs = [e for e in visible if e['tag'] == 'input']
        if not inputs:
            print('  FAIL  No visible input')
            failed += 1
            return

        inp = inputs[0]
        print(f'  [{inp["id"]}] <{inp["tag"]}> placeholder="{inp.get("placeholder","")}"')
        passed += 1

        # Step 3: Click input to focus
        print(f'\nStep 3: Click [{inp["id"]}]...')
        await ws.send(json.dumps({
            'jsonrpc': '2.0', 'method': 'action.click',
            'params': {'elementId': inp['id']}, 'id': 'clk'
        }))
        resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
        ok = resp.get('result', {}).get('success') == True
        print(f'  {"PASS" if ok else "FAIL"}')
        passed += 1 if ok else 0
        failed += 0 if ok else 1

        # Step 4: Type keyword via CDP
        print(f'\nStep 4: Type "手机" via CDP...')
        await ws.send(json.dumps({
            'jsonrpc': '2.0', 'method': 'action.input',
            'params': {'elementId': inp['id'], 'text': '手机'}, 'id': 'inp'
        }))
        resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
        ok = resp.get('result', {}).get('success') == True
        print(f'  {"PASS" if ok else "FAIL"}')
        passed += 1 if ok else 0
        failed += 0 if ok else 1

        # Step 5: Get updated context, find search button
        print('\nStep 5: Find search button...')
        await ws.send(json.dumps({
            'jsonrpc': '2.0', 'method': 'browser.get_context',
            'params': {}, 'id': 'ctx2'
        }))
        resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
        elems = resp['result']['elements']

        btns = [e for e in elems if e.get('inViewport') and e['tag'] in ('button', 'a')]
        print(f'  visible buttons/links: {len(btns)}')
        for b in btns[:5]:
            print(f'    [{b["id"]}] <{b["tag"]}> "{b.get("text","")[:40]}"')

        # Step 6: Click first button or try Enter
        if btns:
            btn = btns[0]
            print(f'\nStep 6: Click [{btn["id"]}]...')
            await ws.send(json.dumps({
                'jsonrpc': '2.0', 'method': 'action.click',
                'params': {'elementId': btn['id']}, 'id': 'clk2'
            }))
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
            ok = resp.get('result', {}).get('success') == True
            print(f'  {"PASS" if ok else "FAIL"}  url={resp.get("result",{}).get("url","N/A")[:60]}')
            passed += 1 if ok else 0
            failed += 0 if ok else 1
        else:
            # Try Enter via old protocol type
            print(f'\nStep 6: No button, pressing Enter...')
            await ws.send(json.dumps({
                'type': 'AGENT_REQUEST', 'task_id': 'enter',
                'action': 'type',
                'payload': {'target_id': inp['id'], 'value': '手机\n'}
            }))
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
            print(f'  Enter: {resp["status"]}')
            passed += 1 if resp['status'] == 'success' else 0
            failed += 0 if resp['status'] == 'success' else 1

        # Step 7: Wait for results page
        print('\nStep 7: Waiting for search results...')
        found = False
        for i in range(6):
            time.sleep(2)
            await ws.send(json.dumps({
                'jsonrpc': '2.0', 'method': 'browser.get_context',
                'params': {}, 'id': f'r{i}'
            }))
            resp = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            url = resp['result']['url']
            elems = resp['result']['elements']
            print(f'  check {i+1}: url={url[:70]}  elements={len(elems)}')
            if 'search' in url.lower() or 'query' in url.lower() or 'keyword' in url.lower() or '手机' in url:
                found = True
                # Show results
                print(f'\n  === Search Results ===')
                count = 0
                for e in elems:
                    txt = e.get('text', '')
                    if len(txt) > 12 and e.get('inViewport'):
                        print(f'  [{e["id"]}] <{e["tag"]}> "{txt[:80]}"')
                        count += 1
                        if count >= 10:
                            break
                if count == 0:
                    print('  (no visible items — likely JS-rendered, DOM has all elements)')
                    # Show top elements anyway
                    for e in elems[:10]:
                        print(f'  [{e["id"]}] <{e["tag"]}> "{e.get("text","")[:60]}"')
                break

        if not found:
            print('  Search results page not detected')

        print(f'\n=== {passed}/{passed+failed} passed ===')

asyncio.run(test())
