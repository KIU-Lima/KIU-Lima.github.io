/**
 * <kiu-ambient> — foto o video con marco que se adapta al contenido y
 * resplandor ambiental (estilo "Ambient Mode" de YouTube).
 *
 * El elemento ocupa la caja que le des por CSS (normalmente position:absolute;
 * inset:0 dentro de un escenario). Mide las dimensiones reales de la imagen o
 * del video y coloca un "wrap" exactamente sobre el rectángulo contenido
 * (sin recorte, centrado). Sobre ese rectángulo:
 *   - .glow  SOLO en modo video: el póster desenfocado y saturado, escalado
 *            un poco, que se derrama fuera del marco con los colores
 *            dominantes. Las fotos no llevan resplandor.
 *   - .media la foto (<img>) o el video (<video controls>), con esquinas
 *            redondeadas que abrazan el encuadre real.
 *   - .ring  contorno fino de 1px pintado por dentro del marco.
 *
 * Atributos:
 *   src        URL de la imagen (modo foto).
 *   alt        Texto alternativo de la foto.
 *   video-src  URL del video (modo video; tiene prioridad sobre src).
 *   poster     Póster del video; también alimenta el resplandor en modo video.
 *
 * Personalización vía CSS custom properties (heredan al shadow DOM):
 *   --ka-radius        radio de las esquinas del marco   (14px)
 *   --ka-glow-blur     desenfoque del resplandor         (40px)
 *   --ka-glow-sat      saturación del resplandor         (1.85)
 *   --ka-glow-opacity  opacidad del resplandor           (0.75)
 *   --ka-glow-scale    escala del resplandor             (1.045)
 *   --ka-shadow        sombra del marco                  (none)
 *   --ka-ring          color del contorno de 1px         (rgba(0,0,0,.08))
 *   --ka-bg            fondo tras la foto (PNG con alfa) (#fff)
 *
 * Mientras no se conocen las dimensiones reales (descarga en curso, metadatos
 * del video pendientes o error), el .wrap entra en modo "fallback": ocupa toda
 * la caja del host con object-fit contain y sin resplandor ni anillo, de modo
 * que la imagen pinta progresivamente y el video muestra poster y controles de
 * inmediato. Al conocerse las dimensiones, el marco se ajusta al encuadre
 * exacto y aparecen el resplandor y el anillo con un fundido.
 *
 * Propiedad de solo lectura `frameRect`: {left, top, width, height} del marco
 * actual en px relativos a la caja del host (null si aún no hay nada visible).
 * La usa la página para limitar lupa/lightbox al área real de la foto.
 */
(() => {
  const CSS =
    ':host{display:block;position:relative}' +
    '.wrap{position:absolute;opacity:0;transition:opacity .35s ease}' +
    '.wrap.on{opacity:1}' +
    '.glow{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;' +
    '  border-radius:var(--ka-radius,14px);' +
    '  filter:blur(var(--ka-glow-blur,40px)) saturate(var(--ka-glow-sat,1.85));' +
    '  transform:scale(var(--ka-glow-scale,1.045));' +
    '  opacity:var(--ka-glow-opacity,.75);pointer-events:none;' +
    '  transition:opacity .45s ease}' +
    '.media{position:absolute;inset:0;width:100%;height:100%;display:block;' +
    '  border:0;border-radius:var(--ka-radius,14px);object-fit:cover;' +
    '  box-shadow:var(--ka-shadow,none);background:var(--ka-bg,#fff)}' +
    '.ring{position:absolute;inset:0;border-radius:var(--ka-radius,14px);' +
    '  box-shadow:inset 0 0 0 1px var(--ka-ring,rgba(0,0,0,.08));pointer-events:none;' +
    '  transition:opacity .45s ease}' +
    // fallback (sin dimensiones aún): contenido contain a caja completa,
    // sin resplandor, anillo, fondo ni sombra — nada que delate un marco
    // equivocado, pero el contenido ya es visible e interactivo.
    '.wrap.fallback .glow{opacity:0}' +
    '.wrap.fallback .ring{opacity:0}' +
    '.wrap.fallback .media{object-fit:contain;background:transparent;box-shadow:none}';

  class KiuAmbient extends HTMLElement {
    static get observedAttributes() { return ['src', 'video-src', 'poster', 'alt']; }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<style>' + CSS + '</style>' +
        '<div class="wrap">' +
        '  <img class="glow" aria-hidden="true" alt="">' +
        '  <img class="media" alt="">' +
        '  <video class="media" controls playsinline preload="metadata" style="display:none"></video>' +
        '  <div class="ring"></div>' +
        '</div>';
      this._wrap = root.querySelector('.wrap');
      this._glow = root.querySelector('.glow');
      this._img = root.querySelector('img.media');
      this._video = root.querySelector('video');
      this._isVideo = false;
      // Los listeners viven con el shadow DOM: montar/desmontar (sc-if) no
      // los duplica. El load relee naturalWidth del propio <img>, así que un
      // load tardío de un src ya reemplazado no puede aplicar medidas viejas.
      this._img.addEventListener('load', () => this._layout());
      this._img.addEventListener('error', () => this._layout());
      this._video.addEventListener('loadedmetadata', () => this._layout());
      this._video.addEventListener('error', () => this._layout());
      this._glow.addEventListener('error', () => { this._glow.style.visibility = 'hidden'; });
      this._glow.addEventListener('load', () => { this._glow.style.visibility = ''; });
    }

    connectedCallback() {
      this._sync();
      // Dispara un primer layout al observar y cubre cambios de tamaño del
      // host (responsive, rotación del teléfono).
      this._ro = new ResizeObserver(() => this._layout());
      this._ro.observe(this);
    }

    disconnectedCallback() {
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      if (this._isVideo) { try { this._video.pause(); } catch (e) {} }
    }

    attributeChangedCallback() { if (this._wrap) this._sync(); }

    _setGlow(u) {
      if (!u) { this._glow.style.display = 'none'; this._glow.removeAttribute('src'); return; }
      this._glow.style.display = '';
      if (this._glow.getAttribute('src') !== u) this._glow.src = u;
    }

    _sync() {
      const vsrc = this.getAttribute('video-src') || '';
      const src = this.getAttribute('src') || '';
      this._isVideo = !!vsrc;
      if (this._isVideo) {
        this._img.style.display = 'none';
        if (this._img.getAttribute('src')) this._img.removeAttribute('src');
        this._video.style.display = '';
        const poster = this.getAttribute('poster') || '';
        if (poster) this._video.poster = poster; else this._video.removeAttribute('poster');
        if (this._video.getAttribute('src') !== vsrc) this._video.src = vsrc;
        this._setGlow(poster);
      } else {
        this._video.style.display = 'none';
        if (this._video.getAttribute('src')) { this._video.removeAttribute('src'); try { this._video.load(); } catch (e) {} }
        this._img.style.display = '';
        this._img.alt = this.getAttribute('alt') || '';
        if (!src) {
          this._img.removeAttribute('src');
          this._wrap.classList.remove('on');
        } else if (this._img.getAttribute('src') !== src) {
          this._img.src = src;
        }
        this._setGlow(''); // sin resplandor en fotos: solo lo llevan los videos
      }
      this._layout();
    }

    _layout() {
      const w = this.clientWidth, h = this.clientHeight;
      // Sin caja (display:none): el ResizeObserver vuelve a llamar aquí.
      if (!w || !h) return;
      const nw = this._isVideo ? this._video.videoWidth : this._img.naturalWidth;
      const nh = this._isVideo ? this._video.videoHeight : this._img.naturalHeight;
      if (!nw || !nh) {
        // Aún sin dimensiones (cargando o error): modo fallback a caja
        // completa. Se muestra solo con un src real; el literal {{ ... }}
        // pre-hidratación se queda oculto.
        const pending = this._isVideo ? (this.getAttribute('video-src') || '') : (this.getAttribute('src') || '');
        this._wrap.style.left = '0px';
        this._wrap.style.top = '0px';
        this._wrap.style.width = w + 'px';
        this._wrap.style.height = h + 'px';
        this._wrap.classList.add('fallback');
        this._wrap.classList.toggle('on', !!pending && pending.indexOf('{{') < 0);
        return;
      }
      const s = Math.min(w / nw, h / nh);
      const cw = nw * s, ch = nh * s;
      this._wrap.style.left = ((w - cw) / 2) + 'px';
      this._wrap.style.top = ((h - ch) / 2) + 'px';
      this._wrap.style.width = cw + 'px';
      this._wrap.style.height = ch + 'px';
      this._wrap.classList.remove('fallback');
      this._wrap.classList.add('on');
    }

    // Marco visible actual en px relativos a la caja del host (null si nada
    // se muestra). Lo consume la página para acotar lupa/lightbox a la foto.
    get frameRect() {
      if (!this._wrap.classList.contains('on')) return null;
      return {
        left: this._wrap.offsetLeft,
        top: this._wrap.offsetTop,
        width: this._wrap.offsetWidth,
        height: this._wrap.offsetHeight,
      };
    }
  }

  if (!customElements.get('kiu-ambient')) {
    customElements.define('kiu-ambient', KiuAmbient);
  }
})();
