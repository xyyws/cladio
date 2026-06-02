/**
 * Particle System — 音频律动粒子系统
 *
 * 核心机制：
 *   1. 每个粒子有 (x, y) 坐标和 (speedX, speedY) 速度向量
 *   2. 鼠标引力场：距离 < 吸引半径时，粒子速度向量朝鼠标方向偏移
 *   3. 连线拓扑图：两两粒子距离 < 阈值时，绘制半透明渐变线
 *   4. 音频律动：低频数据映射到粒子大小、速度、连线亮度
 *   5. requestAnimationFrame 驱动，pointer-events: none 不阻挡交互
 */

const CONFIG = {
  PARTICLE_COUNT: 80,
  MAX_SPEED: 0.5,
  MOUSE_RADIUS: 120,
  MOUSE_FORCE: 0.03,
  CONNECT_DISTANCE: 150,
  PARTICLE_MIN_SIZE: 1.5,
  PARTICLE_MAX_SIZE: 3,
  COLOR_PRIMARY: '0, 243, 255',    // 赛博蓝
  COLOR_SECONDARY: '139, 92, 246', // 紫色
  THEME_COLOR: '0, 243, 255',      // 动态主题色（会被覆盖）
};

class Particle {
  constructor(canvas) {
    this.canvas = canvas;
    this.reset();
  }

  reset() {
    this.x = Math.random() * this.canvas.width;
    this.y = Math.random() * this.canvas.height;
    this.speedX = (Math.random() - 0.5) * CONFIG.MAX_SPEED * 2;
    this.speedY = (Math.random() - 0.5) * CONFIG.MAX_SPEED * 2;
    this.baseSize = CONFIG.PARTICLE_MIN_SIZE + Math.random() * (CONFIG.PARTICLE_MAX_SIZE - CONFIG.PARTICLE_MIN_SIZE);
    this.size = this.baseSize;
    this.opacity = 0.1 + Math.random() * 0.5;
    this.color = Math.random() > 0.5 ? CONFIG.COLOR_PRIMARY : CONFIG.COLOR_SECONDARY;
  }

  update(mouseX, mouseY, audioBoost) {
    // ── 音频律动：低频增大粒子和速度 ──
    const boost = 1 + audioBoost * 1.5; // audioBoost 0-1, 最大 2.5x
    this.size = this.baseSize * boost;

    // ── 鼠标引力场 ──
    if (mouseX !== null && mouseY !== null) {
      const dx = mouseX - this.x;
      const dy = mouseY - this.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < CONFIG.MOUSE_RADIUS) {
        const force = (1 - distance / CONFIG.MOUSE_RADIUS) * CONFIG.MOUSE_FORCE;
        this.speedX += dx * force;
        this.speedY += dy * force;
      }
    }

    // ── 速度衰减（摩擦力），音频 boost 时摩擦减小 ──
    const friction = 0.98 - audioBoost * 0.03; // boost 时更滑
    this.speedX *= friction;
    this.speedY *= friction;

    // ── 速度限制 ──
    const maxSpeed = CONFIG.MAX_SPEED * (3 + audioBoost * 4);
    const speed = Math.sqrt(this.speedX * this.speedX + this.speedY * this.speedY);
    if (speed > maxSpeed) {
      this.speedX = (this.speedX / speed) * maxSpeed;
      this.speedY = (this.speedY / speed) * maxSpeed;
    }

    // ── 更新位置 ──
    this.x += this.speedX;
    this.y += this.speedY;

    // ── 边界环绕 ──
    if (this.x < 0) this.x = this.canvas.width;
    if (this.x > this.canvas.width) this.x = 0;
    if (this.y < 0) this.y = this.canvas.height;
    if (this.y > this.canvas.height) this.y = 0;
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${this.color}, ${this.opacity})`;
    ctx.fill();
  }
}

/**
 * 初始化粒子系统
 * @param {string} canvasId - Canvas 元素 ID
 * @param {Function} getAudioData - 获取音频数据的回调，返回 { bass, mid, treble }
 * @returns {{ destroy: Function, setThemeColor: Function }}
 */
export function initParticleSystem(canvasId, getAudioData) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return { destroy: () => {}, setThemeColor: () => {} };

  const ctx = canvas.getContext('2d');
  let particles = [];
  let mouseX = null;
  let mouseY = null;
  let animationId = null;

  // ── 初始化画布尺寸 ──
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  // ── 初始化粒子 ──
  function initParticles() {
    particles = [];
    for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) {
      particles.push(new Particle(canvas));
    }
  }

  // ── 绘制连线（音频律动：低频时连线更亮更远） ──
  function drawConnections(audioBoost) {
    const connectDist = CONFIG.CONNECT_DISTANCE * (1 + audioBoost * 0.5);
    const baseOpacity = 0.3 + audioBoost * 0.4; // 低频时线条更亮

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < connectDist) {
          const opacity = (1 - distance / connectDist) * baseOpacity;

          const gradient = ctx.createLinearGradient(
            particles[i].x, particles[i].y,
            particles[j].x, particles[j].y
          );
          gradient.addColorStop(0, `rgba(${particles[i].color}, ${opacity})`);
          gradient.addColorStop(1, `rgba(${particles[j].color}, ${opacity})`);

          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = gradient;
          ctx.lineWidth = 0.5 + audioBoost * 1.5; // 低频时线条更粗
          ctx.stroke();
        }
      }
    }
  }

  // ── 主渲染循环 ──
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 获取音频数据
    const audioData = getAudioData ? getAudioData() : { bass: 0, mid: 0, treble: 0 };
    const audioBoost = (audioData.bass || 0) / 255; // 归一化到 0-1

    // 更新并绘制粒子
    for (const p of particles) {
      p.update(mouseX, mouseY, audioBoost);
      p.draw(ctx);
    }

    // 绘制连线
    drawConnections(audioBoost);

    animationId = requestAnimationFrame(animate);
  }

  // ── 鼠标事件 ──
  function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }

  function onMouseLeave() {
    mouseX = null;
    mouseY = null;
  }

  // ── 启动 ──
  resize();
  initParticles();
  animate();

  window.addEventListener('resize', () => {
    resize();
    initParticles();
  });
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseleave', onMouseLeave);

  // ── 动态主题色 ──
  function setThemeColor(r, g, b) {
    CONFIG.THEME_COLOR = `${r}, ${g}, ${b}`;
    // 更新粒子颜色
    for (const p of particles) {
      if (p.color === CONFIG.COLOR_PRIMARY || p.color === CONFIG.THEME_COLOR) {
        p.color = CONFIG.THEME_COLOR;
      }
    }
  }

  return {
    destroy() {
      cancelAnimationFrame(animationId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseleave', onMouseLeave);
    },
    setThemeColor,
  };
}
