// 第一人稱 6 自由度飛行控制：鍵盤／滑鼠（指標鎖定或拖曳）／觸控（左搖桿移動、右半邊環視）
import * as THREE from 'three';
import { C_KM_S, clamp } from './units.js';

const V3 = THREE.Vector3;
export const SPEED_LEVELS = [0.01, 0.1, 1, 10, 100, 1000, 1e4, 1e5, C_KM_S, 10 * C_KM_S, 100 * C_KM_S, 1e3 * C_KM_S, 1e4 * C_KM_S, 1e5 * C_KM_S, 1e6 * C_KM_S, 1e7 * C_KM_S, 1e8 * C_KM_S];

export class Controls {
  constructor(engine, canvas) {
    this.engine = engine; this.canvas = canvas;
    this.keys = new Set();
    this.lookDelta = { x: 0, y: 0 };
    this.rollInput = 0;
    this.velocity = new V3();
    this.autoSpeed = true;
    this.speedLevel = 3;
    this.manualSpeed = SPEED_LEVELS[this.speedLevel];
    this.currentSpeed = 10;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.orbit = null;          // { key, omega }
    this.approach = 0;          // +1 靠近, -1 拉遠（按住）
    this.target = null;         // 目前「關注」的天體 key（用於環繞／靠近／重設視角）
    this.touch = { move: null, look: null, pinchDist: 0 };
    this.joystick = { x: 0, y: 0 };
    this.vertical = 0;          // 觸控升降按鈕
    this.moving = false;
    this.boost = false;         // 按住 Shift 且有移動輸入：目標速度提升到至少 1 c（模擬效果，放開即回復）
    this.enabled = true;
    this.pointerLocked = false;
    this.dragging = false;
    this.onUserMove = null;
    this.lookPending = { x: 0, y: 0 }; // 環視平滑：輸入先累積，再以指數衰減逐幀套用（鏡頭有重量感、無抖動）
    this.lookSmooth = 14;
    this._bind();
  }

  _bind() {
    const c = this.canvas;
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'KeyZ') this.changeSpeed(-1);
      if (e.code === 'KeyX') this.changeSpeed(1);
      if (e.code === 'Space') this.stop();
      this.onKey?.(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    // 滑鼠：點擊畫布 → 指標鎖定；失敗時退回拖曳
    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true; this.lastMouse = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) { this.lookDelta.x += e.movementX; this.lookDelta.y += e.movementY; return; }
      if (this.dragging && this.lastMouse) { this.lookDelta.x += e.clientX - this.lastMouse.x; this.lookDelta.y += e.clientY - this.lastMouse.y; this.lastMouse = { x: e.clientX, y: e.clientY }; }
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    c.addEventListener('dblclick', () => { if (!this.isTouchDevice()) this.requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === c; this.onPointerLock?.(this.pointerLocked); });
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.changeSpeed(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // 觸控
    c.addEventListener('touchstart', (e) => this._touchStart(e), { passive: false });
    c.addEventListener('touchmove', (e) => this._touchMove(e), { passive: false });
    c.addEventListener('touchend', (e) => this._touchEnd(e), { passive: false });
    c.addEventListener('touchcancel', (e) => this._touchEnd(e), { passive: false });
  }

  isTouchDevice() { return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window; }
  requestPointerLock() { try { this.canvas.requestPointerLock?.(); } catch (e) { /* 不支援則用拖曳 */ } }
  exitPointerLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  _touchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const leftHalf = t.clientX < window.innerWidth * 0.45;
      if (leftHalf && !this.touch.move) this.touch.move = { id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY };
      else if (!this.touch.look) this.touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
    if (e.touches.length === 2) {
      const [a, b] = e.touches; this.touch.pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
    this.onTouchJoystick?.(this.touch.move);
  }
  _touchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2 && this.touch.pinchDist) {
      const [a, b] = e.touches; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = d / this.touch.pinchDist;
      if (Math.abs(ratio - 1) > 0.02) { this.pinch = ratio > 1 ? 1 : -1; this.touch.pinchDist = d; }
      return;
    }
    for (const t of e.changedTouches) {
      if (this.touch.move && t.identifier === this.touch.move.id) {
        this.touch.move.x = t.clientX; this.touch.move.y = t.clientY;
        const dx = (t.clientX - this.touch.move.x0) / 60, dy = (t.clientY - this.touch.move.y0) / 60;
        this.joystick.x = clamp(dx, -1, 1); this.joystick.y = clamp(-dy, -1, 1);
        this.onTouchJoystick?.(this.touch.move);
      } else if (this.touch.look && t.identifier === this.touch.look.id) {
        this.lookDelta.x += (t.clientX - this.touch.look.x) * 1.6; this.lookDelta.y += (t.clientY - this.touch.look.y) * 1.6;
        this.touch.look.x = t.clientX; this.touch.look.y = t.clientY;
      }
    }
  }
  _touchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (this.touch.move && t.identifier === this.touch.move.id) { this.touch.move = null; this.joystick.x = 0; this.joystick.y = 0; this.onTouchJoystick?.(null); }
      if (this.touch.look && t.identifier === this.touch.look.id) this.touch.look = null;
    }
    if (e.touches.length < 2) this.touch.pinchDist = 0;
  }

  changeSpeed(dir) {
    if (this.autoSpeed) { this.autoSpeed = false; this.speedLevel = SPEED_LEVELS.findIndex((s) => s >= this.currentSpeed); if (this.speedLevel < 0) this.speedLevel = SPEED_LEVELS.length - 1; }
    this.speedLevel = clamp(this.speedLevel + dir, 0, SPEED_LEVELS.length - 1);
    this.manualSpeed = SPEED_LEVELS[this.speedLevel];
    this.onSpeedChange?.();
  }
  setAutoSpeed(on) { this.autoSpeed = on; this.onSpeedChange?.(); }
  stop() { this.velocity.set(0, 0, 0); this.orbit = null; this.approach = 0; this.onStop?.(); }
  setOrbit(key, on = true, periodSec = 150) { this.orbit = on && key ? { key, omega: 2 * Math.PI / periodSec } : null; if (on) this.velocity.set(0, 0, 0); }

  // 把相機朝向 target（up 為「上」方向，例如天體北極）
  lookAt(relTarget, up = new V3(0, 1, 0)) {
    const m = new THREE.Matrix4().lookAt(new V3(0, 0, 0), relTarget, up);
    this.engine.camQuat.setFromRotationMatrix(m);
  }

  update(dt, nearest) {
    if (!this.enabled) { this.lookDelta.x = 0; this.lookDelta.y = 0; this.lookPending.x = 0; this.lookPending.y = 0; return; }
    const eng = this.engine; const q = eng.camQuat;
    // ---- 環視（平滑）
    this.lookPending.x += this.lookDelta.x; this.lookPending.y += this.lookDelta.y;
    this.lookDelta.x = 0; this.lookDelta.y = 0;
    const kl = this.lookSmooth > 0 ? 1 - Math.exp(-dt * this.lookSmooth) : 1;
    const ax = this.lookPending.x * kl, ay = this.lookPending.y * kl;
    this.lookPending.x -= ax; this.lookPending.y -= ay;
    if (Math.abs(this.lookPending.x) < 0.01) this.lookPending.x = 0; if (Math.abs(this.lookPending.y) < 0.01) this.lookPending.y = 0;
    const yaw = -ax * this.sensitivity, pitch = -ay * this.sensitivity * (this.invertY ? -1 : 1);
    let roll = 0;
    if (this.keys.has('KeyQ')) roll += 1.2 * dt; if (this.keys.has('KeyE')) roll -= 1.2 * dt;
    if (this.keys.has('ArrowLeft')) this._yawPitch(q, 1.3 * dt, 0); if (this.keys.has('ArrowRight')) this._yawPitch(q, -1.3 * dt, 0);
    if (this.keys.has('ArrowUp')) this._yawPitch(q, 0, 1.0 * dt); if (this.keys.has('ArrowDown')) this._yawPitch(q, 0, -1.0 * dt);
    if (yaw || pitch) { this._yawPitch(q, yaw, pitch); if (this.orbit) this.orbit.lookLocked = false; }
    if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 0, 1), roll));
    q.normalize();
    // ---- 移動輸入（相機座標）
    const mv = new V3();
    if (this.keys.has('KeyW')) mv.z -= 1; if (this.keys.has('KeyS')) mv.z += 1;
    if (this.keys.has('KeyA')) mv.x -= 1; if (this.keys.has('KeyD')) mv.x += 1;
    if (this.keys.has('KeyR')) mv.y += 1;
    if (this.keys.has('KeyF') || this.keys.has('ControlLeft')) mv.y -= 1;
    mv.x += this.joystick.x; mv.z -= this.joystick.y; mv.y += this.vertical;
    const hasInput = mv.lengthSq() > 1e-6;
    if (hasInput) { if (mv.length() > 1) mv.normalize(); this.orbit = null; this.onUserMove?.(); }
    // ---- 自動速度：依到最近天體邊界的距離；按住 Shift（光速）時至少 1 c
    const distB = nearest ? Math.max(nearest.distToBoundary, 0) : 1e9;
    const auto = clamp(distB * 0.35, 0.3, 3e12);
    this.boost = hasInput && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    let targetSpeed = this.autoSpeed ? auto : this.manualSpeed;
    if (this.boost) targetSpeed = Math.max(targetSpeed, C_KM_S);
    this.currentSpeed = targetSpeed;
    const desired = mv.applyQuaternion(q).multiplyScalar(targetSpeed);
    // 慣性：有輸入時加速、無輸入時緩慢減速（像推進器關閉後仍漂浮，但為了可用性加入阻尼）
    const k = hasInput ? 1 - Math.exp(-dt * 4) : 1 - Math.exp(-dt * 2.5);
    this.velocity.lerp(desired, k);
    if (!hasInput && this.velocity.length() < targetSpeed * 0.002) this.velocity.set(0, 0, 0);
    this.moving = this.velocity.lengthSq() > 0;
    // ---- 靠近／拉遠（對 target 或最近天體）
    const focus = this._focusInfo(nearest);
    if ((this.approach || this.pinch) && focus) {
      const dir = this.approach || this.pinch; this.pinch = 0;
      const rel = focus.rel.clone(); const d = rel.length(); const bound = focus.bound;
      const nd = dir > 0 ? Math.max(bound * 1.001, bound + (d - bound) * Math.exp(-1.2 * dt)) : bound + (d - bound) * Math.exp(1.2 * dt);
      const n = rel.normalize();
      eng.camPos[0] = focus.pos[0] - n.x * nd; eng.camPos[1] = focus.pos[1] - n.y * nd; eng.camPos[2] = focus.pos[2] - n.z * nd;
      this.velocity.set(0, 0, 0);
    }
    // ---- 自動環繞
    if (this.orbit && focus) {
      const rel = new V3(eng.camPos[0] - focus.pos[0], eng.camPos[1] - focus.pos[1], eng.camPos[2] - focus.pos[2]);
      const axis = focus.axis || new V3(0, 1, 0);
      rel.applyAxisAngle(axis, this.orbit.omega * dt);
      eng.camPos[0] = focus.pos[0] + rel.x; eng.camPos[1] = focus.pos[1] + rel.y; eng.camPos[2] = focus.pos[2] + rel.z;
      if (this.orbit.lookLocked !== false) this.lookAt(rel.clone().negate(), axis);
    }
    // ---- 積分位置
    if (this.moving) {
      eng.camPos[0] += this.velocity.x * dt; eng.camPos[1] += this.velocity.y * dt; eng.camPos[2] += this.velocity.z * dt;
    }
    // ---- 碰撞／觀測邊界
    if (nearest && !nearest.extra?.noCollide) {
      const rel = new V3(eng.camPos[0] - nearest.pos[0], eng.camPos[1] - nearest.pos[1], eng.camPos[2] - nearest.pos[2]);
      const d = rel.length();
      if (d < nearest.bound) {
        const n = rel.normalize();
        eng.camPos[0] = nearest.pos[0] + n.x * nearest.bound; eng.camPos[1] = nearest.pos[1] + n.y * nearest.bound; eng.camPos[2] = nearest.pos[2] + n.z * nearest.bound;
        const vin = this.velocity.dot(n);
        if (vin < 0) this.velocity.addScaledVector(n, -vin);
        this.onCollide?.(nearest);
      }
    }
  }

  _yawPitch(q, yaw, pitch) {
    if (yaw) q.multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), yaw));
    if (pitch) q.multiply(new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), pitch));
  }

  _focusInfo(nearest) {
    const eng = this.engine;
    if (this.target) {
      if (eng.frame.type === 'solar') {
        const e = eng.bodies.get(this.target);
        if (e) { const rel = new V3(e.pos[0] - eng.camPos[0], e.pos[1] - eng.camPos[1], e.pos[2] - eng.camPos[2]); return { pos: e.pos, rel, bound: e.def.radius + e.def.minAltitude, axis: e.axes?.yb }; }
      } else {
        const e = eng.extraBodies.find((x) => x.key === this.target);
        if (e) { const rel = new V3(e.pos[0] - eng.camPos[0], e.pos[1] - eng.camPos[1], e.pos[2] - eng.camPos[2]); return { pos: e.pos, rel, bound: e.radius + (e.minAltitude || 0), axis: new V3(0, 1, 0) }; }
      }
    }
    if (nearest) return { pos: nearest.pos, rel: nearest.rel, bound: nearest.bound, axis: nearest.axes?.yb };
    return null;
  }
}
