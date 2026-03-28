import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import { Play, RotateCcw } from 'lucide-react';

// --- Audio Helpers ---
let audioCtx: AudioContext | null = null;
function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
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

// --- Game Logic ---
const BOUNDS = 100;
const PLAYER_SPEED = 12;
const ENEMY_SPEED = 6;

interface Echo {
    id: number;
    position: THREE.Vector3;
    radius: number;
    opacity: number;
}

interface Enemy {
    id: number;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    rotation: THREE.Euler;
    type: 'roamer' | 'seeker';
}

interface Wall {
    position: THREE.Vector3;
    scale: THREE.Vector3;
}

function GameScene({ setGameState, setScore, setEnergy }: { setGameState: any, setScore: any, setEnergy: any }) {
    const { camera } = useThree();
    const lightRef = useRef<THREE.PointLight>(null);
    
    const [echoes, setEchoes] = useState<Echo[]>([]);
    const echoesRef = useRef<Echo[]>([]);
    
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const enemiesRef = useRef<Enemy[]>([]);
    
    const scoreRef = useRef(0);
    const energyRef = useRef(100);
    const keys = useRef<{ [key: string]: boolean }>({});
    
    const walls = useMemo(() => {
        const w: Wall[] = [];
        for (let i = 0; i < 400; i++) {
            const x = (Math.random() - 0.5) * BOUNDS * 1.8;
            const z = (Math.random() - 0.5) * BOUNDS * 1.8;
            // Clear spawn area
            if (Math.abs(x) < 5 && Math.abs(z) < 5) continue; 
            
            const isHorizontal = Math.random() > 0.5;
            w.push({
                position: new THREE.Vector3(x, 2, z),
                scale: new THREE.Vector3(isHorizontal ? 4 + Math.random() * 12 : 1, 4, isHorizontal ? 1 : 4 + Math.random() * 12)
            });
        }
        return w;
    }, []);

    const wallsRef = useRef<THREE.InstancedMesh>(null);

    useEffect(() => {
        if (wallsRef.current) {
            const dummy = new THREE.Object3D();
            walls.forEach((wall, i) => {
                dummy.position.copy(wall.position);
                dummy.scale.copy(wall.scale);
                dummy.updateMatrix();
                wallsRef.current!.setMatrixAt(i, dummy.matrix);
            });
            wallsRef.current.instanceMatrix.needsUpdate = true;
        }
    }, [walls]);

    useEffect(() => {
        camera.position.set(0, 1.5, 0);
        camera.rotation.set(0, 0, 0);
    }, [camera]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            keys.current[e.key.toLowerCase()] = true;
            if (e.key === ' ' && energyRef.current >= 20) {
                playPing();
                energyRef.current -= 20;
                setEnergy(energyRef.current);
                const newEcho = { id: Date.now(), position: camera.position.clone(), radius: 0, opacity: 1 };
                echoesRef.current.push(newEcho);
                // Limit active echoes to prevent performance drops from too many point lights
                if (echoesRef.current.length > 3) {
                    echoesRef.current.shift();
                }
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false; };
        
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [camera, setEnergy]);

    useFrame((state, delta) => {
        // Flashlight follows camera
        if (lightRef.current) {
            lightRef.current.position.copy(state.camera.position);
        }

        // FPS Movement
        const forward = new THREE.Vector3();
        state.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        const move = new THREE.Vector3();
        if (keys.current['w'] || keys.current['arrowup']) move.add(forward);
        if (keys.current['s'] || keys.current['arrowdown']) move.sub(forward);
        if (keys.current['d'] || keys.current['arrowright']) move.add(right);
        if (keys.current['a'] || keys.current['arrowleft']) move.sub(right);
        
        if (move.lengthSq() > 0) {
            move.normalize().multiplyScalar(PLAYER_SPEED * delta);
        }

        const nextPos = state.camera.position.clone().add(move);
        
        // Wall collision for player
        let collision = false;
        const playerRadius = 0.5;
        for (const wall of walls) {
            const minX = wall.position.x - wall.scale.x / 2 - playerRadius;
            const maxX = wall.position.x + wall.scale.x / 2 + playerRadius;
            const minZ = wall.position.z - wall.scale.z / 2 - playerRadius;
            const maxZ = wall.position.z + wall.scale.z / 2 + playerRadius;
            
            if (nextPos.x > minX && nextPos.x < maxX && nextPos.z > minZ && nextPos.z < maxZ) {
                collision = true;
                break;
            }
        }

        if (!collision) {
            state.camera.position.x = nextPos.x;
            state.camera.position.z = nextPos.z;
        } else {
            // Slide along walls
            const nextPosX = state.camera.position.clone().add(new THREE.Vector3(move.x, 0, 0));
            let colX = false;
            for (const wall of walls) {
                const minX = wall.position.x - wall.scale.x / 2 - playerRadius;
                const maxX = wall.position.x + wall.scale.x / 2 + playerRadius;
                const minZ = wall.position.z - wall.scale.z / 2 - playerRadius;
                const maxZ = wall.position.z + wall.scale.z / 2 + playerRadius;
                if (nextPosX.x > minX && nextPosX.x < maxX && nextPosX.z > minZ && nextPosX.z < maxZ) { colX = true; break; }
            }
            if (!colX) state.camera.position.x = nextPosX.x;

            const nextPosZ = state.camera.position.clone().add(new THREE.Vector3(0, 0, move.z));
            let colZ = false;
            for (const wall of walls) {
                const minX = wall.position.x - wall.scale.x / 2 - playerRadius;
                const maxX = wall.position.x + wall.scale.x / 2 + playerRadius;
                const minZ = wall.position.z - wall.scale.z / 2 - playerRadius;
                const maxZ = wall.position.z + wall.scale.z / 2 + playerRadius;
                if (nextPosZ.x > minX && nextPosZ.x < maxX && nextPosZ.z > minZ && nextPosZ.z < maxZ) { colZ = true; break; }
            }
            if (!colZ) state.camera.position.z = nextPosZ.z;
        }
        
        state.camera.position.x = THREE.MathUtils.clamp(state.camera.position.x, -BOUNDS, BOUNDS);
        state.camera.position.z = THREE.MathUtils.clamp(state.camera.position.z, -BOUNDS, BOUNDS);
        state.camera.position.y = 1.5; // Lock height

        // Echoes update
        echoesRef.current.forEach(e => {
            e.radius += 35 * delta; // Faster expansion
            e.opacity -= 0.6 * delta; // Fade out
        });
        echoesRef.current = echoesRef.current.filter(e => e.opacity > 0);
        setEchoes([...echoesRef.current]);

        // Score & Energy
        scoreRef.current += delta;
        setScore(scoreRef.current);
        
        energyRef.current = Math.min(100, energyRef.current + 15 * delta);
        setEnergy(energyRef.current);

        // Enemy spawn
        if (Math.random() < 0.02 + scoreRef.current * 0.0005) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 25 + Math.random() * 15;
            const spawnPos = state.camera.position.clone().add(new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist));
            spawnPos.y = 0.5;
            
            enemiesRef.current.push({
                id: Date.now() + Math.random(),
                position: spawnPos,
                velocity: new THREE.Vector3(0, 0, 0),
                rotation: new THREE.Euler(0, 0, 0),
                type: Math.random() > 0.5 ? 'roamer' : 'seeker'
            });
        }

        // Enemy update & collision
        let gameOver = false;
        enemiesRef.current.forEach(enemy => {
            if (enemy.type === 'seeker') {
                const dir = state.camera.position.clone().sub(enemy.position).normalize();
                dir.y = 0;
                enemy.velocity.lerp(dir.multiplyScalar(ENEMY_SPEED), 2 * delta);
            } else {
                if (enemy.velocity.lengthSq() < 0.1) {
                    const angle = Math.random() * Math.PI * 2;
                    enemy.velocity.set(Math.cos(angle) * ENEMY_SPEED, 0, Math.sin(angle) * ENEMY_SPEED);
                }
            }
            
            const nextEnemyPos = enemy.position.clone().add(enemy.velocity.clone().multiplyScalar(delta));
            let enemyCol = false;
            const enemyRadius = 0.5;
            for (const wall of walls) {
                const minX = wall.position.x - wall.scale.x / 2 - enemyRadius;
                const maxX = wall.position.x + wall.scale.x / 2 + enemyRadius;
                const minZ = wall.position.z - wall.scale.z / 2 - enemyRadius;
                const maxZ = wall.position.z + wall.scale.z / 2 + enemyRadius;
                if (nextEnemyPos.x > minX && nextEnemyPos.x < maxX && nextEnemyPos.z > minZ && nextEnemyPos.z < maxZ) {
                    enemyCol = true;
                    break;
                }
            }

            if (!enemyCol) {
                enemy.position.copy(nextEnemyPos);
            } else {
                if (enemy.type === 'roamer') {
                    enemy.velocity.negate();
                }
            }
            
            enemy.rotation.x += delta * (enemy.type === 'seeker' ? 5 : 2);
            enemy.rotation.y += delta * (enemy.type === 'seeker' ? 5 : 2);

            // Check collision with player
            const distToPlayer = new THREE.Vector2(enemy.position.x - state.camera.position.x, enemy.position.z - state.camera.position.z).length();
            if (distToPlayer < 1.2) {
                gameOver = true;
            }
        });
        
        // Remove far enemies
        enemiesRef.current = enemiesRef.current.filter(e => e.position.distanceTo(state.camera.position) < BOUNDS * 1.5);
        setEnemies([...enemiesRef.current]);

        if (gameOver) {
            playDeath();
            document.exitPointerLock();
            setGameState('gameover');
        }
    });

    return (
        <>
            <fog attach="fog" args={['#000000', 2, 25]} />
            <ambientLight intensity={0.01} />
            <pointLight ref={lightRef} color="#ffffff" intensity={0.5} distance={10} decay={2} />
            
            <PointerLockControls />

            {/* Echoes */}
            {echoes.map(echo => (
                <group key={echo.id} position={echo.position}>
                    <pointLight 
                        color="#00e5ff" 
                        intensity={echo.opacity * 15} 
                        distance={echo.radius * 1.2} 
                        decay={2}
                    />
                    <mesh>
                        <sphereGeometry args={[echo.radius, 32, 16]} />
                        <meshBasicMaterial 
                            color="#00e5ff" 
                            wireframe 
                            transparent 
                            opacity={echo.opacity * 0.2} 
                            blending={THREE.AdditiveBlending}
                            depthWrite={false}
                        />
                    </mesh>
                </group>
            ))}

            {/* Enemies */}
            {enemies.map(enemy => (
                <mesh key={enemy.id} position={enemy.position} rotation={enemy.rotation}>
                    {enemy.type === 'seeker' ? (
                        <coneGeometry args={[0.5, 1, 4]} />
                    ) : (
                        <boxGeometry args={[0.8, 0.8, 0.8]} />
                    )}
                    <meshStandardMaterial 
                        color={enemy.type === 'seeker' ? '#ff9900' : '#ff3366'} 
                        emissive={enemy.type === 'seeker' ? '#ff9900' : '#ff3366'} 
                        emissiveIntensity={0.8} 
                        wireframe
                    />
                </mesh>
            ))}

            {/* Walls (Instanced for Performance) */}
            <instancedMesh ref={wallsRef} args={[undefined, undefined, walls.length]}>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color="#111111" roughness={0.9} />
            </instancedMesh>

            {/* Floor & Ceiling */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
                <planeGeometry args={[BOUNDS * 2.5, BOUNDS * 2.5]} />
                <meshStandardMaterial color="#050505" roughness={1} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 4, 0]}>
                <planeGeometry args={[BOUNDS * 2.5, BOUNDS * 2.5]} />
                <meshStandardMaterial color="#020202" roughness={1} />
            </mesh>
        </>
    );
}

export default function App() {
    const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover'>('menu');
    const [score, setScore] = useState(0);
    const [energy, setEnergy] = useState(100);

    return (
        <div className="relative w-full h-screen bg-black overflow-hidden font-mono select-none">
            {gameState === 'playing' && (
                <>
                    <Canvas shadows camera={{ fov: 75 }}>
                        <GameScene setGameState={setGameState} setScore={setScore} setEnergy={setEnergy} />
                    </Canvas>
                    
                    {/* Crosshair */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                        <div className="w-1.5 h-1.5 bg-white/50 rounded-full" />
                    </div>

                    {/* UI Overlay */}
                    <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start pointer-events-none z-10">
                        <div>
                            <div className="text-gray-400 text-sm tracking-widest mb-1">SIGNAL STRENGTH</div>
                            <div className="w-48 h-2 bg-gray-900 rounded overflow-hidden shadow-[0_0_10px_rgba(0,229,255,0.2)]">
                                <div 
                                    className="h-full bg-cyan-400 transition-all duration-100 ease-out"
                                    style={{ width: `${energy}%`, boxShadow: '0 0 10px #00e5ff' }}
                                />
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-gray-400 text-sm tracking-widest mb-1">SURVIVAL TIME</div>
                            <div className="text-2xl font-bold text-white tracking-wider">
                                {Math.floor(score)}<span className="text-sm text-gray-500">s</span>
                            </div>
                        </div>
                    </div>
                </>
            )}
            
            {gameState === 'menu' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-black/80 backdrop-blur-sm z-20">
                    <h1 className="text-6xl md:text-8xl font-bold mb-4 tracking-[0.2em] text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-500">
                        ECHO DRIFT 3D
                    </h1>
                    <p className="mb-12 text-gray-400 tracking-widest uppercase text-sm md:text-base">
                        Navigate the endless dark. Avoid anomalies.
                    </p>
                    
                    <div className="flex flex-wrap justify-center gap-12 mb-12 text-sm text-gray-400">
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
                            <div className="w-24 h-24 border border-gray-600 rounded-full bg-gray-900 shadow-[0_4px_0_rgb(75,85,99)] mb-3 flex items-center justify-center">
                                <span className="text-xs font-bold tracking-widest">MOUSE</span>
                            </div>
                            <span className="tracking-widest">LOOK</span>
                        </div>
                        <div className="flex flex-col items-center justify-end">
                            <kbd className="w-32 h-10 flex items-center justify-center border border-gray-600 rounded bg-gray-900 shadow-[0_4px_0_rgb(75,85,99)] mb-3">SPACE</kbd>
                            <span className="tracking-widest">ECHO PULSE</span>
                        </div>
                    </div>
                    
                    <button
                        className="group relative px-8 py-4 bg-white text-black font-bold rounded overflow-hidden transition-transform hover:scale-105 active:scale-95"
                        onClick={() => { 
                            getAudioCtx(); 
                            setScore(0);
                            setEnergy(100);
                            setGameState('playing'); 
                        }}
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <span className="relative flex items-center gap-2 tracking-widest">
                            <Play size={20} /> INITIATE
                        </span>
                    </button>
                    <p className="mt-6 text-xs text-gray-500 tracking-widest">CLICK CANVAS TO LOCK MOUSE AFTER STARTING</p>
                </div>
            )}
            
            {gameState === 'gameover' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white bg-black/80 backdrop-blur-sm z-20">
                    <h1 className="text-6xl md:text-8xl font-bold mb-4 tracking-[0.2em] text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,0.5)]">
                        SIGNAL LOST
                    </h1>
                    <p className="mb-12 text-2xl text-gray-300 tracking-widest">
                        SURVIVAL TIME: <span className="text-white font-bold">{Math.floor(score)}s</span>
                    </p>
                    
                    <button
                        className="group relative px-8 py-4 bg-white text-black font-bold rounded overflow-hidden transition-transform hover:scale-105 active:scale-95"
                        onClick={() => { 
                            getAudioCtx(); 
                            setScore(0);
                            setEnergy(100);
                            setGameState('playing'); 
                        }}
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
