#!/usr/bin/env python3
"""本次分支的一次性、可重入整合工具；不建置網站、不改其他開發者檔案。
只有預期文字完全相符才修改 renderer uniform 與模組接線。
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace(path, before, after):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if after in text:
        return
    if text.count(before) != 1:
        raise ValueError(f'{path} 內容已變動，拒絕自動覆寫：{before[:80]}')
    p.write_text(text.replace(before, after), encoding='utf-8')

replace('js/shaders.js', '  uniform float uCloudShift;', '  uniform float uCloudOpacity; // 1=歷史雲層；0=地表檢視（非即時晴空）\n  uniform float uCloudShift;')
replace('js/shaders.js', 'float clouds = texture2D(uBRC, cuv).b;', 'float clouds = texture2D(uBRC, cuv).b * uCloudOpacity;')
replace('js/shaders.js', 'float cloudShadow = 1.0 - 0.45 * texture2D(uBRC, shadowUv).b;', 'float cloudShadow = 1.0 - 0.45 * texture2D(uBRC, shadowUv).b * uCloudOpacity;')
replace('js/engine.js', 'uCloudShift: { value: 0 },', 'uCloudShift: { value: 0 }, uCloudOpacity: { value: 1 },')
replace('js/earthlod.js', "'uDetail', 'uCloudShift',", "'uDetail', 'uCloudShift', 'uCloudOpacity',")
replace('js/main.js', "import { SpaceAudio } from './audio.js';", "import { SpaceAudio } from './audio.js';\nimport { EarthSurfaceView } from './earthview.js';")
replace('js/main.js', '  // 測試鉤子（瀏覽器自動化用）', '  const earthView = new EarthSurfaceView(engine, controls, ui);\n\n  // 測試鉤子（瀏覽器自動化用）')
replace('js/main.js', '    engine, controls, catalog, goTo,', '    engine, controls, catalog, goTo, earthView,')
replace('js/main.js', '    engine.render();', '    engine.render();\n    earthView.update();')
css = ROOT / 'css/app.css'
styles = '''
/* 地表檢視標示：不影響飛行手勢，也不把隱藏歷史雲圖稱作當下晴空。 */
#earth-layer-note { position:fixed; left:calc(14px + var(--sal)); bottom:calc(14px + var(--sab)); z-index:26; max-width:calc(100vw - 110px); padding:5px 9px; border-radius:6px; color:#e3edf6; background:rgba(0,0,0,.65); font-size:11px; line-height:1.5; pointer-events:none; }
#earth-layer-note[hidden] { display:none; }
#earth-layer-note.with-hud { bottom:calc(180px + var(--sab)); }
.earth-view-setting input { min-width:24px; min-height:24px; }
'''
text = css.read_text(encoding='utf-8')
if '#earth-layer-note {' not in text:
    css.write_text(text + styles, encoding='utf-8')
print('地表檢視整合完成（可重複執行，來源標示保留）')

# 分塊預算要計入尚在下載的貼圖，不能只在載入完成後清理。
replace('js/earthlod.js', "    const key = p.userData.key;\n    const t = { tex:", "    const key = p.userData.key;\n    const reserved = (this.loading + 1) * TILE_BYTES;\n    this._evict(reserved);\n    if (this.loadedBytes + reserved > this.budgetBytes) return false; // 不夠額度時保留 4K，不發出額外請求\n    const t = { tex:")
replace('js/earthlod.js', '  _evict() {\n    if (this.loadedBytes <= this.budgetBytes) return;', '  _evict(reservedBytes = 0) {\n    if (this.loadedBytes + reservedBytes <= this.budgetBytes) return;')
replace('js/earthlod.js', '      if (this.loadedBytes <= this.budgetBytes * 0.85) break;', '      if (this.loadedBytes + reservedBytes <= this.budgetBytes * 0.85) break;')
replace('js/earthlod.js', "      const earth = this.engine.bodies.get('earth'); if (!earth) return;", "      const earth = this.engine.bodies.get('earth'); if (!earth) { tex.dispose(); return; }")
replace('js/earthlod.js', '      earth.mesh.material.uniforms.uDay.value = tex;', '      const previous = earth.mesh.material.uniforms.uDay.value;\n      earth.mesh.material.uniforms.uDay.value = tex;')
replace('js/earthlod.js', '      this.baseSwapped = true;', "      const basePath = earth.def.textures.day;\n      if (this.engine.textures[basePath] === previous) this.engine.textures[basePath] = tex;\n      if (previous && previous !== tex) previous.dispose();\n      this.baseSwapped = true;")
print('分塊排隊預算及舊底圖釋放完成')
