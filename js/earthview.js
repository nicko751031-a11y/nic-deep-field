// 地表檢視：只隱藏歷史合成雲層，不能稱作當下晴空或即時觀測。
export class EarthSurfaceView {
  constructor(engine, controls, ui) {
    this.engine = engine;
    this.controls = controls;
    this.ui = ui;
    this.cloudsVisible = true;
    const settings = document.getElementById('settings');
    const label = document.createElement('label');
    const caption = document.createElement('span');
    caption.textContent = '顯示歷史雲層（關閉可看地表細節）';
    this.input = document.createElement('input');
    this.input.type = 'checkbox'; this.input.id = 's-earth-clouds'; this.input.checked = true;
    label.htmlFor = this.input.id; label.append(caption, this.input);
    const hint = document.createElement('p'); hint.className = 'sub';
    hint.textContent = '雲層是固定歷史快照；隱藏不代表即時晴空。地形與近即時氣象仍是獨立資料層。';
    const group = document.createElement('section'); group.className = 'earth-view-setting';
    group.setAttribute('aria-label', '地球圖層'); group.append(label, hint);
    const h3 = settings?.querySelector('h3');
    if (h3) h3.after(group); else settings?.append(group);
    this.note = document.createElement('div'); this.note.id = 'earth-layer-note';
    this.note.hidden = true; this.note.setAttribute('role', 'status');
    this.note.textContent = '地表檢視 · 歷史雲層已隱藏 · 非即時晴空';
    document.body.append(this.note);
    this.input.addEventListener('change', () => this.setCloudsVisible(this.input.checked));
  }
  setCloudsVisible(visible) {
    this.cloudsVisible = Boolean(visible); this.input.checked = this.cloudsVisible;
    const uniform = this.engine.bodies.get('earth')?.mesh.material.uniforms.uCloudOpacity;
    if (uniform) uniform.value = this.cloudsVisible ? 1 : 0;
    this.update();
  }
  update() {
    const show = !this.cloudsVisible && this.engine.frame.type === 'solar' && this.controls.target === 'earth';
    this.note.hidden = !show;
    this.note.classList.toggle('with-hud', !this.ui.hidden && !document.body.classList.contains('idle'));
  }
}
