import React, { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw } from 'lucide-react';

// --- Math & Collision Helpers ---
function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(max, val));
}

function circleRectCollide(circle: { x: number, y: number, radius: number }, rect: { x: number, y: number, w: number, h: number }) {
    let closestX = clamp(circle.x, rect.x, rect.x + rect.w);
    let closestY = clamp(circle.y, rect.y, rect.y + rect.h);
    let dx = circle.x - closestX;
    let dy = circle.y - closestY;
    return (dx * dx + dy * dy) < (circle.radius * circle.radius);
}

// --- Audio Helpers ---
let audioCtx: AudioContext | null = null;
function getAudioCtx() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioCtx;
}

function playPing() {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.5);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
}

function playDeath() {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.5);

    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
}

// --- Game Types ---
type EnemyType = 'roamer' | 'stalker' | 'seeker';

interface Player {
    x: number; y: number; vx: number; vy: number;
    radius: number; speed: number; friction: number;
    energy: number; maxEnergy: number; energyRegen: number; echoCost: number;
}

interface Echo {
    x: number; y: number; radius: number; maxRadius: number;
    speed: number; opacity: number; thickness: number;
}

interface Wall {
    x: number; y: number; w: number; h: number;
}

interface Enemy {
    x: number; y: number; vx: number; vy: number;
    radius: number; speed: number; type: EnemyType;
}

// --- Game Engine ---
class EchoGame {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    maskCanvas: HTMLCanvasElement;
    maskCtx: CanvasRenderingContext2D;
    width: number = 0;
    height: number = 0;

    state: 'menu' | 'playing' | 'gameover' = 'menu';
    score: number = 0;
    setGameState: (s: 'menu' | 'playing' | 'gameover') => void;
    setScore: (s: number) => void;

    player!: Player;
    echoes: Echo[] = [];
    walls: Wall[] = [];
    enemies: Enemy[] = [];
    keys: { [key: string]: boolean } = {};

    lastTime: number = 0;
    enemySpawnTimer: number = 0;
    animationFrameId: number = 0;

    constructor(canvas: HTMLCanvasElement, setGameState: any, setScore: any) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.maskCanvas = document.createElement('canvas');
        this.maskCtx = this.maskCanvas.getContext('2d')!;
        this.setGameState = setGameState;
        this.setScore = setScore;

        this.resize();
        window.addEventListener('resize', this.resize);
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
    }

    cleanup() {
        window.removeEventListener('resize', this.resize);
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        cancelAnimationFrame(this.animationFrameId);
    }

    resize = () => {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.maskCanvas.width = this.width;
        this.maskCanvas.height = this.height;
        if (this.state === 'menu') {
            this.drawMenuBackground();
        }
    }

    onKeyDown = (e: KeyboardEvent) => {
        this.keys[e.key.toLowerCase()] = true;
        if (e.key === ' ' && this.state === 'playing') {
            this.triggerEcho();
        }
    }

    onKeyUp = (e: KeyboardEvent) => {
        this.keys[e.key.toLowerCase()] = false;
    }

    init() {
        this.drawMenuBackground();
    }

    drawMenuBackground() {
        this.ctx.fillStyle = '#050505';
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(this.width / 2, this.height / 2, 150, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.arc(this.width / 2, this.height / 2, 300, 0, Math.PI * 2);
        this.ctx.stroke();
    }

    start() {
        // Initialize AudioContext on user interaction
        getAudioCtx();
        
        this.state = 'playing';
        this.setGameState('playing');
        this.score = 0;
        this.player = {
            x: this.width / 2,
            y: this.height / 2,
            vx: 0, vy: 0,
            radius: 8,
            speed: 0.8,
            friction: 0.85,
            energy: 100,
            maxEnergy: 100,
            energyRegen: 0.15,
            echoCost: 30
        };
        this.echoes = [];
        this.enemies = [];
        this.generateLevel();
        this.enemySpawnTimer = 2000;
        this.lastTime = performance.now();
        
        // Trigger initial echo to show surroundings
        this.triggerEcho(true);
        
        cancelAnimationFrame(this.animationFrameId);
        this.loop(this.lastTime);
    }

    gameOver() {
        this.state = 'gameover';
        this.setGameState('gameover');
        this.setScore(this.score);
        playDeath();
    }

    triggerEcho(free = false) {
        if (free || this.player.energy >= this.player.echoCost) {
            if (!free) this.player.energy -= this.player.echoCost;
            this.echoes.push({
                x: this.player.x,
                y: this.player.y,
                radius: 10,
                maxRadius: Math.max(this.width, this.height) * 1.2,
                speed: 12,
                opacity: 1,
                thickness: 30
            });
            playPing();
        }
    }

    generateLevel() {
        this.walls = [];
        let numWalls = Math.floor((this.width * this.height) / 25000);
        for (let i = 0; i < numWalls; i++) {
            let isHorizontal = Math.random() > 0.5;
            let w = isHorizontal ? 150 + Math.random() * 200 : 20 + Math.random() * 20;
            let h = isHorizontal ? 20 + Math.random() * 20 : 150 + Math.random() * 200;
            let x = 20 + Math.random() * (this.width - w - 40);
            let y = 20 + Math.random() * (this.height - h - 40);

            let cx = x + w / 2;
            let cy = y + h / 2;
            let dx = cx - this.width / 2;
            let dy = cy - this.height / 2;
            if (Math.sqrt(dx * dx + dy * dy) < 200) {
                continue;
            }
            this.walls.push({ x, y, w, h });
        }
    }

    spawnEnemy() {
        let typeWeights = [
            Math.max(1, 10 - this.score / 10), // roamer
            this.score / 15,                 // stalker
            this.score / 30                  // seeker
        ];
        let totalWeight = typeWeights.reduce((a, b) => a + b, 0);
        let r = Math.random() * totalWeight;
        let type: EnemyType = 'roamer';
        if (r > typeWeights[0]) type = 'stalker';
        if (r > typeWeights[0] + typeWeights[1]) type = 'seeker';

        let x, y;
        if (Math.random() > 0.5) {
            x = Math.random() > 0.5 ? -20 : this.width + 20;
            y = Math.random() * this.height;
        } else {
            x = Math.random() * this.width;
            y = Math.random() > 0.5 ? -20 : this.height + 20;
        }

        let speed = type === 'roamer' ? 1.5 + Math.random() :
                    type === 'stalker' ? 2.5 + Math.random() :
                    2.0 + Math.random();

        let vx = 0, vy = 0;
        if (type === 'roamer') {
            let angle = Math.random() * Math.PI * 2;
            vx = Math.cos(angle) * speed;
            vy = Math.sin(angle) * speed;
        }

        this.enemies.push({
            x, y, vx, vy, radius: 10, speed, type
        });
    }

    loop = (time: number) => {
        this.animationFrameId = requestAnimationFrame(this.loop);
        if (this.state !== 'playing') return;

        let dt = time - this.lastTime;
        this.lastTime = time;
        if (dt > 100) dt = 100;

        this.update(dt);
        this.draw();
    }

    update(dt: number) {
        let timeScale = dt / 16.66;

        let ax = 0, ay = 0;
        if (this.keys['w'] || this.keys['arrowup']) ay -= 1;
        if (this.keys['s'] || this.keys['arrowdown']) ay += 1;
        if (this.keys['a'] || this.keys['arrowleft']) ax -= 1;
        if (this.keys['d'] || this.keys['arrowright']) ax += 1;

        if (ax !== 0 && ay !== 0) {
            let len = Math.sqrt(ax * ax + ay * ay);
            ax /= len; ay /= len;
        }

        this.player.vx += ax * this.player.speed * timeScale;
        this.player.vy += ay * this.player.speed * timeScale;

        this.player.vx *= Math.pow(this.player.friction, timeScale);
        this.player.vy *= Math.pow(this.player.friction, timeScale);

        this.player.x += this.player.vx * timeScale;
        this.collidePlayerWalls('x', timeScale);
        this.player.y += this.player.vy * timeScale;
        this.collidePlayerWalls('y', timeScale);

        this.player.x = clamp(this.player.x, this.player.radius, this.width - this.player.radius);
        this.player.y = clamp(this.player.y, this.player.radius, this.height - this.player.radius);

        this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + this.player.energyRegen * timeScale);

        for (let i = this.echoes.length - 1; i >= 0; i--) {
            let e = this.echoes[i];
            e.radius += e.speed * timeScale;
            e.opacity -= 0.01 * timeScale;
            if (e.opacity <= 0 || e.radius > e.maxRadius) {
                this.echoes.splice(i, 1);
            }
        }

        for (let enemy of this.enemies) {
            this.updateEnemy(enemy, timeScale);
            let dx = enemy.x - this.player.x;
            let dy = enemy.y - this.player.y;
            if (dx * dx + dy * dy < (enemy.radius + this.player.radius) ** 2) {
                this.gameOver();
            }
        }

        this.score += dt / 1000;

        this.enemySpawnTimer -= dt;
        if (this.enemySpawnTimer <= 0) {
            this.spawnEnemy();
            this.enemySpawnTimer = Math.max(500, 2000 - this.score * 15);
        }
    }

    updateEnemy(enemy: Enemy, timeScale: number) {
        if (enemy.type === 'roamer') {
            // Keep moving
        } else if (enemy.type === 'stalker') {
            let visible = false;
            if (Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y) < 80) visible = true;
            for (let e of this.echoes) {
                if (Math.abs(Math.hypot(enemy.x - e.x, enemy.y - e.y) - e.radius) < e.thickness) {
                    visible = true;
                    break;
                }
            }
            if (!visible) {
                let angle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
                enemy.vx += Math.cos(angle) * 0.1 * timeScale;
                enemy.vy += Math.sin(angle) * 0.1 * timeScale;
                
                // Cap speed
                let currentSpeed = Math.hypot(enemy.vx, enemy.vy);
                if (currentSpeed > enemy.speed) {
                    enemy.vx = (enemy.vx / currentSpeed) * enemy.speed;
                    enemy.vy = (enemy.vy / currentSpeed) * enemy.speed;
                }
            } else {
                enemy.vx *= Math.pow(0.8, timeScale);
                enemy.vy *= Math.pow(0.8, timeScale);
            }
        } else if (enemy.type === 'seeker') {
            let targetX = this.player.x;
            let targetY = this.player.y;
            if (this.echoes.length > 0) {
                let latestEcho = this.echoes[this.echoes.length - 1];
                targetX = latestEcho.x;
                targetY = latestEcho.y;
            }
            let angle = Math.atan2(targetY - enemy.y, targetX - enemy.x);
            enemy.vx += Math.cos(angle) * 0.05 * timeScale;
            enemy.vy += Math.sin(angle) * 0.05 * timeScale;
            
            let currentSpeed = Math.hypot(enemy.vx, enemy.vy);
            if (currentSpeed > enemy.speed) {
                enemy.vx = (enemy.vx / currentSpeed) * enemy.speed;
                enemy.vy = (enemy.vy / currentSpeed) * enemy.speed;
            }
        }

        enemy.x += enemy.vx * timeScale;
        this.collideEnemyWalls(enemy, 'x', timeScale);
        enemy.y += enemy.vy * timeScale;
        this.collideEnemyWalls(enemy, 'y', timeScale);
    }

    collidePlayerWalls(axis: 'x' | 'y', timeScale: number) {
        for (let wall of this.walls) {
            if (circleRectCollide(this.player, wall)) {
                if (axis === 'x') {
                    this.player.x -= this.player.vx * timeScale;
                    this.player.vx = 0;
                } else {
                    this.player.y -= this.player.vy * timeScale;
                    this.player.vy = 0;
                }
            }
        }
    }

    collideEnemyWalls(enemy: Enemy, axis: 'x' | 'y', timeScale: number) {
        for (let wall of this.walls) {
            if (circleRectCollide(enemy, wall)) {
                if (axis === 'x') {
                    enemy.x -= enemy.vx * timeScale;
                    enemy.vx *= -1;
                } else {
                    enemy.y -= enemy.vy * timeScale;
                    enemy.vy *= -1;
                }
            }
        }
    }

    draw() {
        // 1. Draw Scene
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.fillStyle = '#050505';
        this.ctx.fillRect(0, 0, this.width, this.height);

        this.ctx.fillStyle = '#00e5ff';
        this.ctx.shadowColor = '#00e5ff';
        this.ctx.shadowBlur = 10;
        for (let wall of this.walls) {
            this.ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
        }

        this.ctx.shadowBlur = 15;
        for (let enemy of this.enemies) {
            if (enemy.type === 'roamer') {
                this.ctx.fillStyle = '#ff3366';
                this.ctx.shadowColor = '#ff3366';
            } else if (enemy.type === 'stalker') {
                this.ctx.fillStyle = '#ff0000';
                this.ctx.shadowColor = '#ff0000';
            } else {
                this.ctx.fillStyle = '#ff9900';
                this.ctx.shadowColor = '#ff9900';
            }
            this.ctx.beginPath();
            this.ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
            this.ctx.fill();
        }
        this.ctx.shadowBlur = 0;

        // 2. Draw Mask
        this.maskCtx.globalCompositeOperation = 'source-over';
        this.maskCtx.fillStyle = '#000000';
        this.maskCtx.fillRect(0, 0, this.width, this.height);

        let grad = this.maskCtx.createRadialGradient(this.player.x, this.player.y, 0, this.player.x, this.player.y, 80);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        this.maskCtx.fillStyle = grad;
        this.maskCtx.beginPath();
        this.maskCtx.arc(this.player.x, this.player.y, 80, 0, Math.PI * 2);
        this.maskCtx.fill();

        for (let echo of this.echoes) {
            this.maskCtx.fillStyle = `rgba(255, 255, 255, ${echo.opacity * 0.15})`;
            this.maskCtx.beginPath();
            this.maskCtx.arc(echo.x, echo.y, echo.radius, 0, Math.PI * 2);
            this.maskCtx.fill();

            this.maskCtx.strokeStyle = `rgba(255, 255, 255, ${echo.opacity})`;
            this.maskCtx.lineWidth = echo.thickness;
            this.maskCtx.shadowColor = '#ffffff';
            this.maskCtx.shadowBlur = 20;
            this.maskCtx.beginPath();
            this.maskCtx.arc(echo.x, echo.y, echo.radius, 0, Math.PI * 2);
            this.maskCtx.stroke();
        }
        this.maskCtx.shadowBlur = 0;

        // 3. Multiply Mask onto Scene
        this.ctx.globalCompositeOperation = 'multiply';
        this.ctx.drawImage(this.maskCanvas, 0, 0);

        // 4. Draw Player
        this.ctx.globalCompositeOperation = 'source-over';
        this.ctx.fillStyle = '#ffffff';
        this.ctx.shadowColor = '#ffffff';
        this.ctx.shadowBlur = 15;
        this.ctx.beginPath();
        this.ctx.arc(this.player.x, this.player.y, this.player.radius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.shadowBlur = 0;

        // 5. Draw UI
        this.drawUI();
    }

    drawUI() {
        let barWidth = 200;
        let barHeight = 6;
        let x = this.width / 2 - barWidth / 2;
        let y = this.height - 40;

        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        this.ctx.fillRect(x, y, barWidth, barHeight);

        this.ctx.fillStyle = '#ffffff';
        this.ctx.shadowColor = '#ffffff';
        this.ctx.shadowBlur = 10;
        this.ctx.fillRect(x, y, barWidth * (this.player.energy / this.player.maxEnergy), barHeight);
        this.ctx.shadowBlur = 0;

        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        this.ctx.font = '16px "Inter", sans-serif';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`TIME: ${Math.floor(this.score)}s`, 30, 40);
    }
}

export default function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover'>('menu');
    const [score, setScore] = useState(0);
    const gameRef = useRef<EchoGame | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;
        const game = new EchoGame(canvasRef.current, setGameState, setScore);
        gameRef.current = game;
        game.init();

        return () => game.cleanup();
    }, []);

    return (
        <div className="relative w-full h-screen bg-black overflow-hidden font-mono select-none">
            <canvas ref={canvasRef} className="block w-full h-full" />
            
            {gameState === 'menu' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-black/80 backdrop-blur-sm">
                    <h1 className="text-6xl md:text-8xl font-bold mb-4 tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-500">
                        ECHO DRIFT
                    </h1>
                    <p className="mb-12 text-gray-400 tracking-widest uppercase text-sm md:text-base">
                        Navigate the dark. Avoid anomalies.
                    </p>
                    
                    <div className="flex gap-12 mb-12 text-sm text-gray-400">
                        <div className="flex flex-col items-center">
                            <div className="flex flex-col items-center gap-1 mb-3">
                                <kbd className="w-10 h-10 flex items-center justify-center border border-gray-600 rounded bg-gray-900 shadow-[0_4px_0_rgb(75,85,99)]">W</kbd>
                                <div className="flex gap-1">
                                    <kbd className="w-10 h-10 flex items-center justify-center border border-gray-600 rounded bg-gray-900 shadow-[0_4px_0_rgb(75,85,99)]">A</kbd>
                                    <kbd className="w-10 h-10 flex items-center justify-center border border-gray-600 rounded bg-gray-900 shadow-[0_4px_0_rgb(75,85,99)]">S</kbd>
                                    <kbd className="w-10 h-10 flex items-center justify-center border border-gray-600 rounded bg-gray-900 shadow-[0_4px_0_rgb(75,85,99)]">D</kbd>
                                </div>
                            </div>
                            <span className="tracking-widest">MOVE</span>
                        </div>
                        <div className="flex flex-col items-center justify-end">
                            <kbd className="w-32 h-10 flex items-center justify-center border border-gray-600 rounded bg-gray-900 shadow-[0_4px_0_rgb(75,85,99)] mb-3">SPACE</kbd>
                            <span className="tracking-widest">ECHO PULSE</span>
                        </div>
                    </div>
                    
                    <button
                        className="group relative px-8 py-4 bg-white text-black font-bold rounded overflow-hidden transition-transform hover:scale-105 active:scale-95"
                        onClick={() => gameRef.current?.start()}
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <span className="relative flex items-center gap-2 tracking-widest">
                            <Play size={20} /> INITIATE
                        </span>
                    </button>
                </div>
            )}
            
            {gameState === 'gameover' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-black/80 backdrop-blur-sm">
                    <h1 className="text-6xl md:text-8xl font-bold mb-4 tracking-[0.2em] text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,0.5)]">
                        SIGNAL LOST
                    </h1>
                    <p className="mb-12 text-2xl text-gray-300 tracking-widest">
                        SURVIVAL TIME: <span className="text-white font-bold">{Math.floor(score)}s</span>
                    </p>
                    
                    <button
                        className="group relative px-8 py-4 bg-white text-black font-bold rounded overflow-hidden transition-transform hover:scale-105 active:scale-95"
                        onClick={() => gameRef.current?.start()}
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-red-500 to-orange-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <span className="relative flex items-center gap-2 tracking-widest group-hover:text-white transition-colors">
                            <RotateCcw size={20} /> RESTART
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
}
