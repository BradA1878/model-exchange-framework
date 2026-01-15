// MXF Diagram Utilities

class MXFDiagram {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            width: options.width || 1200,
            height: options.height || 700,
            padding: options.padding || 40,
            animate: options.animate !== false,
            interactive: options.interactive !== false,
            ...options
        };
        this.tooltip = null;
        this.zoom = 1;
        this.pan = { x: 0, y: 0 };
        this.init();
    }

    init() {
        // Create SVG
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'diagram-svg');
        this.svg.setAttribute('viewBox', `0 0 ${this.options.width} ${this.options.height}`);
        
        // Create defs for markers and gradients
        this.defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        this.svg.appendChild(this.defs);
        this.createMarkers();
        
        // Create main group for pan/zoom
        this.mainGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.mainGroup.setAttribute('class', 'main-group');
        this.svg.appendChild(this.mainGroup);
        
        this.container.appendChild(this.svg);
        
        // Create tooltip
        this.createTooltip();
        
        // Setup interactions
        if (this.options.interactive) {
            this.setupInteractions();
        }
    }

    createMarkers() {
        // Arrow marker
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        arrow.setAttribute('id', 'arrowhead');
        arrow.setAttribute('markerWidth', '10');
        arrow.setAttribute('markerHeight', '7');
        arrow.setAttribute('refX', '9');
        arrow.setAttribute('refY', '3.5');
        arrow.setAttribute('orient', 'auto');
        
        const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        arrowPath.setAttribute('points', '0 0, 10 3.5, 0 7');
        arrowPath.setAttribute('class', 'edge-arrow');
        arrow.appendChild(arrowPath);
        this.defs.appendChild(arrow);

        // Colored arrow markers
        const colors = ['blue', 'green', 'orange', 'pink', 'purple', 'red'];
        const colorValues = {
            blue: '#3b82f6', green: '#22c55e', orange: '#f97316',
            pink: '#ec4899', purple: '#6366f1', red: '#ef4444'
        };
        
        colors.forEach(color => {
            const marker = arrow.cloneNode(true);
            marker.setAttribute('id', `arrowhead-${color}`);
            marker.querySelector('polygon').setAttribute('fill', colorValues[color]);
            this.defs.appendChild(marker);
        });
    }

    createTooltip() {
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'tooltip';
        document.body.appendChild(this.tooltip);
    }

    showTooltip(event, title, description) {
        this.tooltip.innerHTML = `
            <div class="tooltip-title">${title}</div>
            ${description ? `<div class="tooltip-desc">${description}</div>` : ''}
        `;
        this.tooltip.classList.add('visible');
        
        const rect = this.container.getBoundingClientRect();
        let x = event.clientX + 15;
        let y = event.clientY + 15;
        
        // Keep tooltip in viewport
        const tooltipRect = this.tooltip.getBoundingClientRect();
        if (x + tooltipRect.width > window.innerWidth) {
            x = event.clientX - tooltipRect.width - 15;
        }
        if (y + tooltipRect.height > window.innerHeight) {
            y = event.clientY - tooltipRect.height - 15;
        }
        
        this.tooltip.style.left = x + 'px';
        this.tooltip.style.top = y + 'px';
    }

    hideTooltip() {
        this.tooltip.classList.remove('visible');
    }

    setupInteractions() {
        // Pan and zoom
        let isPanning = false;
        let startPoint = { x: 0, y: 0 };

        this.svg.addEventListener('mousedown', (e) => {
            if (e.target === this.svg || e.target.classList.contains('group-rect')) {
                isPanning = true;
                startPoint = { x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
                this.svg.style.cursor = 'grabbing';
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (isPanning) {
                this.pan.x = e.clientX - startPoint.x;
                this.pan.y = e.clientY - startPoint.y;
                this.updateTransform();
            }
        });

        document.addEventListener('mouseup', () => {
            isPanning = false;
            this.svg.style.cursor = 'default';
        });

        this.svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this.zoom = Math.min(Math.max(0.5, this.zoom * delta), 3);
            this.updateTransform();
        });
    }

    updateTransform() {
        this.mainGroup.setAttribute('transform', 
            `translate(${this.pan.x}, ${this.pan.y}) scale(${this.zoom})`);
    }

    // Helper methods for creating elements
    createGroup(x, y, label, width, height, className = '') {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `group ${className}`);
        
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'group-rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', width);
        rect.setAttribute('height', height);
        g.appendChild(rect);
        
        if (label) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('class', 'group-label');
            text.setAttribute('x', x + 12);
            text.setAttribute('y', y + 20);
            text.textContent = label;
            g.appendChild(text);
        }
        
        return g;
    }

    createNode(x, y, label, options = {}) {
        const width = options.width || 140;
        const height = options.height || 50;
        const sublabel = options.sublabel || '';
        const icon = options.icon || '';
        const nodeType = options.type || '';
        const tooltip = options.tooltip || '';

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `node ${nodeType ? 'node-' + nodeType : ''}`);
        g.setAttribute('transform', `translate(${x - width/2}, ${y - height/2})`);
        
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'node-rect');
        rect.setAttribute('width', width);
        rect.setAttribute('height', height);
        g.appendChild(rect);
        
        let textY = height / 2;
        if (sublabel) textY -= 8;
        if (icon) textY += 8;
        
        if (icon) {
            const iconText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            iconText.setAttribute('class', 'node-icon');
            iconText.setAttribute('x', width / 2);
            iconText.setAttribute('y', height / 2 - 12);
            iconText.textContent = icon;
            g.appendChild(iconText);
        }
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'node-text');
        text.setAttribute('x', width / 2);
        text.setAttribute('y', textY);
        text.textContent = label;
        g.appendChild(text);
        
        if (sublabel) {
            const subtext = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            subtext.setAttribute('class', 'node-text node-text-small');
            subtext.setAttribute('x', width / 2);
            subtext.setAttribute('y', textY + 16);
            subtext.textContent = sublabel;
            g.appendChild(subtext);
        }
        
        // Tooltip interaction
        if (tooltip) {
            g.addEventListener('mouseenter', (e) => this.showTooltip(e, label, tooltip));
            g.addEventListener('mouseleave', () => this.hideTooltip());
        }
        
        // Animate entrance
        if (this.options.animate) {
            g.style.opacity = '0';
            g.style.transform += ' scale(0.8)';
            setTimeout(() => {
                g.style.transition = 'all 0.4s ease';
                g.style.opacity = '1';
                g.style.transform = g.style.transform.replace('scale(0.8)', 'scale(1)');
            }, options.delay || 0);
        }
        
        return g;
    }

    createEdge(x1, y1, x2, y2, options = {}) {
        const curved = options.curved !== false;
        const animated = options.animated || false;
        const color = options.color || '';
        const label = options.label || '';
        
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'edge-group');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let d;
        
        if (curved) {
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const offset = Math.min(Math.abs(dx), Math.abs(dy)) * 0.3;
            
            if (Math.abs(dx) > Math.abs(dy)) {
                d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
            } else {
                d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
            }
        } else {
            d = `M ${x1} ${y1} L ${x2} ${y2}`;
        }
        
        path.setAttribute('d', d);
        path.setAttribute('class', `edge ${animated ? 'edge-animated' : ''}`);
        path.setAttribute('marker-end', `url(#arrowhead${color ? '-' + color : ''})`);
        
        if (color) {
            const colorValues = {
                blue: '#3b82f6', green: '#22c55e', orange: '#f97316',
                pink: '#ec4899', purple: '#6366f1', red: '#ef4444'
            };
            path.style.stroke = colorValues[color] || color;
        }
        
        g.appendChild(path);
        
        if (label) {
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textNode.setAttribute('class', 'message-text');
            textNode.setAttribute('x', midX);
            textNode.setAttribute('y', midY - 4);
            textNode.setAttribute('text-anchor', 'middle');
            textNode.textContent = label;
            
            g.appendChild(textNode);
        }
        
        return g;
    }

    createDatabase(x, y, label, options = {}) {
        const width = options.width || 80;
        const height = options.height || 60;
        
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'node node-database');
        g.setAttribute('transform', `translate(${x - width/2}, ${y - height/2})`);
        
        // Database cylinder shape
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const rx = width / 2;
        const ry = 8;
        
        const d = `
            M 0 ${ry}
            A ${rx} ${ry} 0 0 1 ${width} ${ry}
            L ${width} ${height - ry}
            A ${rx} ${ry} 0 0 1 0 ${height - ry}
            Z
            M 0 ${ry}
            A ${rx} ${ry} 0 0 0 ${width} ${ry}
        `;
        
        path.setAttribute('d', d);
        path.setAttribute('class', 'node-rect');
        g.appendChild(path);
        
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'node-text');
        text.setAttribute('x', width / 2);
        text.setAttribute('y', height / 2 + 5);
        text.textContent = label;
        g.appendChild(text);
        
        if (options.tooltip) {
            g.addEventListener('mouseenter', (e) => this.showTooltip(e, label, options.tooltip));
            g.addEventListener('mouseleave', () => this.hideTooltip());
        }
        
        return g;
    }

    // Animation helpers
    animateEntrance(elements, stagger = 50) {
        elements.forEach((el, i) => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(20px)';
            setTimeout(() => {
                el.style.transition = 'all 0.4s ease';
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            }, i * stagger);
        });
    }

    // Render method (to be overridden by specific diagrams)
    render() {
        throw new Error('render() must be implemented by subclass');
    }
}

// Theme management
function initTheme() {
    const saved = localStorage.getItem('mxf-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeButton(theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('mxf-theme', next);
    updateThemeButton(next);
}

function updateThemeButton(theme) {
    const icon = document.querySelector('.theme-toggle-icon');
    const label = document.querySelector('.theme-toggle-label');
    if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    if (label) label.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

// Initialize theme on load
document.addEventListener('DOMContentLoaded', initTheme);

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MXFDiagram, initTheme, toggleTheme };
}
