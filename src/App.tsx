import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, Noise, ChromaticAberration } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import { HeartPulse, Zap, Footprints } from 'lucide-react';

// --- Constants ---
const BOUNDS = 150;
const BASE_SPEED = 3.5;
const SPRINT_SPEED = 6.5;
const ENEMY_SPEED_IDLE = 1.5;
const ENEMY_SPEED_HUNT = 5.5;
const MAX_ECHOES = 2;

// --- Audio System ---
const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
const masterGain = audioCtx.createGain();
masterGain.connect(audioCtx.destination);
masterGain.gain.value = 0.6;

const playSound = (type: 'ping' | 'step' | 'heartbeat' | 'scare' | 'drone', distance: number = 0, intensity: number = 1) => {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    
    const now = audioCtx.currentTime;
    const distFactor = Math.max(0, 1 - distance / 60);
    const vol = intensity * distFactor;

    if (type === 'ping') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 1.5);
        gain.gain.setValueAtTime(vol * 0.8, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 1.5);
        filter.type = 'lowpass';
        filter.frequency.value = 1500;
        osc.start(now);
        osc.stop(now + 1.5);
    } else if (type === 'step') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(80, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
        gain.gain.setValueAtTime(vol * 0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        filter.type = 'lowpass';
        filter.frequency.value = 800;
        osc.start(now);
        osc.stop(now + 0.15);
    } else if (type === 'heartbeat') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(50, now);
        osc.frequency.exponentialRampToValueAtTime(35, now + 0.4);
        gain.gain.setValueAtTime(vol * 0.5, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.4);
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        osc.start(now);
        osc.stop(now + 0.4);
    } else if (type === 'scare') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.2);
        osc.frequency.exponentialRampToValueAtTime(40, now + 2);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(vol, now + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 2);
        filter.type = 'bandpass';
        filter.frequency.value = 2000;
        osc.start(now);
        osc.stop(now + 2);
    }
};

// --- Types ---
type EnemyState = 'idle' | 'stalking' | 'hunting';
interface Enemy {
    id: number;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    rotation: THREE.Euler;
    type: 'seeker' | 'roamer';
    state: EnemyState;
    awareness: number;
}

interface Wall {
    position: THREE.Vector3;
    scale: THREE.Vector3;
}

// --- Components ---
function GameScene({ setGameState, setEnergy, setStamina, setStress, setDanger }: any) {
    const { camera, scene } = useThree();
    const keys = useRef<{ [key: string]: boolean }>({});
    const echoesRef = useRef<{ id: number, position: THREE.Vector3, radius: number, opacity: number }[]>([]);
    const [echoes, setEchoes] = useState<any[]>([]);
    const enemiesRef = useRef<Enemy[]>([]);
    const [enemies, setEnemies] = useState<Enemy[]>([]);
    const energyRef = useRef(100);
    const staminaRef = useRef(100);
    const stressRef = useRef(0);
    const lightRef = useRef<THREE.PointLight>(null);
    const wallsRef = useRef<THREE.InstancedMesh>(null);
    
    // Movement & Bobbing state
    const playerVelocity = useRef(new THREE.Vector3());
    const bobTimer = useRef(0);
    const lastStepTime = useRef(0);
    const lastHeartbeatTime = useRef(0);

    const walls = useMemo(() => {
        const w: Wall[] = [];
        // Create a more structured, maze-like environment
        for (let i = 0; i < 600; i++) {
            const x = (Math.random() - 0.5) * BOUNDS * 2;
            const z = (Math.random() - 0.5) * BOUNDS * 2;
            if (Math.abs(x) < 8 && Math.abs(z) < 8) continue; 
            
            const isHorizontal = Math.random() > 0.5;
            const length = 4 + Math.random() * 16;
            w.push({
                position: new THREE.Vector3(x, 2.5, z),
                scale: new THREE.Vector3(isHorizontal ? length : 1.5, 5, isHorizontal ? 1.5 : length)
            });
        }
        return w;
    }, []);

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
        camera.position.set(0, 1.6, 0); // Average eye height
        camera.rotation.set(0, 0, 0);
        scene.fog = new THREE.FogExp2('#020202', 0.08); // Dense volumetric-like fog
    }, [camera, scene]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            keys.current[e.key.toLowerCase()] = true;
            if (e.key === ' ' && energyRef.current >= 25) {
                playSound('ping', 0, 1);
                energyRef.current -= 25;
                setEnergy(energyRef.current);
                
                // Alert nearby enemies
                enemiesRef.current.forEach(en => {
                    const dist = en.position.distanceTo(camera.position);
                    if (dist < 40) en.awareness += 50;
                });

                const newEcho = { id: Date.now(), position: camera.position.clone(), radius: 0, opacity: 1 };
                echoesRef.current.push(newEcho);
                if (echoesRef.current.length > MAX_ECHOES) echoesRef.current.shift();
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
        const time = state.clock.getElapsedTime();

        // --- Player Movement & Physics ---
        const isSprinting = keys.current['shift'] && staminaRef.current > 0 && (keys.current['w'] || keys.current['arrowup']);
        const targetSpeed = isSprinting ? SPRINT_SPEED : BASE_SPEED;
        
        const forward = new THREE.Vector3();
        state.camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();

        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        const moveDir = new THREE.Vector3();
        if (keys.current['w'] || keys.current['arrowup']) moveDir.add(forward);
        if (keys.current['s'] || keys.current['arrowdown']) moveDir.sub(forward);
        if (keys.current['d'] || keys.current['arrowright']) moveDir.add(right);
        if (keys.current['a'] || keys.current['arrowleft']) moveDir.sub(right);
        
        if (moveDir.lengthSq() > 0) moveDir.normalize();

        // Smooth acceleration/deceleration
        playerVelocity.current.lerp(moveDir.multiplyScalar(targetSpeed), 10 * delta);
        
        const isMoving = playerVelocity.current.lengthSq() > 0.1;
        
        // Head Bobbing
        if (isMoving) {
            bobTimer.current += delta * (isSprinting ? 15 : 10);
            state.camera.position.y = 1.6 + Math.sin(bobTimer.current) * (isSprinting ? 0.08 : 0.04);
            
            // Footstep sounds
            if (time - lastStepTime.current > (isSprinting ? 0.3 : 0.5)) {
                playSound('step', 0, isSprinting ? 0.5 : 0.2);
                lastStepTime.current = time;
            }
        } else {
            // Return to resting height smoothly
            state.camera.position.y = THREE.MathUtils.lerp(state.camera.position.y, 1.6, 5 * delta);
            bobTimer.current = 0;
        }

        // Camera sway based on velocity
        state.camera.rotation.z = THREE.MathUtils.lerp(state.camera.rotation.z, -playerVelocity.current.clone().dot(right) * 0.01, 5 * delta);

        // Apply movement with collision
        const nextPos = state.camera.position.clone().add(playerVelocity.current.clone().multiplyScalar(delta));
        const playerRadius = 0.6;
        
        let colX = false, colZ = false;
        const nextPosX = state.camera.position.clone().add(new THREE.Vector3(playerVelocity.current.x * delta, 0, 0));
        const nextPosZ = state.camera.position.clone().add(new THREE.Vector3(0, 0, playerVelocity.current.z * delta));

        for (const wall of walls) {
            const minX = wall.position.x - wall.scale.x / 2 - playerRadius;
            const maxX = wall.position.x + wall.scale.x / 2 + playerRadius;
            const minZ = wall.position.z - wall.scale.z / 2 - playerRadius;
            const maxZ = wall.position.z + wall.scale.z / 2 + playerRadius;
            
            if (nextPosX.x > minX && nextPosX.x < maxX && nextPosX.z > minZ && nextPosX.z < maxZ) colX = true;
            if (nextPosZ.x > minX && nextPosZ.x < maxX && nextPosZ.z > minZ && nextPosZ.z < maxZ) colZ = true;
        }

        if (!colX) state.camera.position.x = nextPosX.x;
        if (!colZ) state.camera.position.z = nextPosZ.z;
        
        state.camera.position.x = THREE.MathUtils.clamp(state.camera.position.x, -BOUNDS, BOUNDS);
        state.camera.position.z = THREE.MathUtils.clamp(state.camera.position.z, -BOUNDS, BOUNDS);

        // Flashlight follows camera but with slight lag for weight
        if (lightRef.current) {
            lightRef.current.position.lerp(state.camera.position, 20 * delta);
        }

        // --- Resource Management ---
        if (isSprinting) {
            staminaRef.current = Math.max(0, staminaRef.current - 20 * delta);
        } else {
            staminaRef.current = Math.min(100, staminaRef.current + 10 * delta);
        }
        setStamina(staminaRef.current);

        energyRef.current = Math.min(100, energyRef.current + 8 * delta);
        setEnergy(energyRef.current);

        // --- Echoes Update ---
        echoesRef.current.forEach(e => {
            e.radius += 40 * delta; // Fast initial expansion
            e.opacity -= 0.4 * delta;
        });
        echoesRef.current = echoesRef.current.filter(e => e.opacity > 0);
        setEchoes([...echoesRef.current]);

        // --- Enemy AI & Spawning ---
        let closestEnemyDist = Infinity;

        if (Math.random() < 0.01 && enemiesRef.current.length < 15) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 30 + Math.random() * 20;
            const spawnPos = state.camera.position.clone().add(new THREE.Vector3(Math.cos(angle) * dist, 0, Math.sin(angle) * dist));
            spawnPos.y = 1;
            
            enemiesRef.current.push({
                id: Date.now() + Math.random(),
                position: spawnPos,
                velocity: new THREE.Vector3(),
                rotation: new THREE.Euler(),
                type: Math.random() > 0.3 ? 'seeker' : 'roamer',
                state: 'idle',
                awareness: 0
            });
        }

        let gameOver = false;
        enemiesRef.current.forEach(enemy => {
            const distToPlayer = enemy.position.distanceTo(state.camera.position);
            closestEnemyDist = Math.min(closestEnemyDist, distToPlayer);

            // AI State Machine
            if (distToPlayer < 15 || enemy.awareness > 50) {
                enemy.state = 'hunting';
                enemy.awareness = 100;
            } else if (distToPlayer < 30 || enemy.awareness > 20) {
                enemy.state = 'stalking';
            } else {
                enemy.state = 'idle';
                enemy.awareness = Math.max(0, enemy.awareness - 5 * delta);
            }

            // Movement based on state
            let speed = ENEMY_SPEED_IDLE;
            if (enemy.state === 'hunting') {
                speed = ENEMY_SPEED_HUNT;
                const dir = state.camera.position.clone().sub(enemy.position).normalize();
                dir.y = 0;
                // Unnatural jerky movement
                if (Math.random() > 0.1) {
                    enemy.velocity.lerp(dir.multiplyScalar(speed), 5 * delta);
                } else {
                    enemy.velocity.set(0,0,0); // Sudden pauses
                }
            } else if (enemy.state === 'stalking') {
                speed = ENEMY_SPEED_IDLE * 0.5;
                const dir = state.camera.position.clone().sub(enemy.position).normalize();
                dir.y = 0;
                enemy.velocity.lerp(dir.multiplyScalar(speed), 2 * delta);
            } else {
                if (enemy.velocity.lengthSq() < 0.1 || Math.random() < 0.02) {
                    const angle = Math.random() * Math.PI * 2;
                    enemy.velocity.set(Math.cos(angle) * speed, 0, Math.sin(angle) * speed);
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
                enemy.velocity.negate();
                enemy.awareness += 10; // Getting stuck makes them angry
            }
            
            // Unnatural rotation
            enemy.rotation.x += delta * (Math.random() * 5);
            enemy.rotation.y += delta * (Math.random() * 5);

            if (distToPlayer < 1.5) {
                gameOver = true;
            }
        });
        
        enemiesRef.current = enemiesRef.current.filter(e => e.position.distanceTo(state.camera.position) < BOUNDS * 1.2);
        setEnemies([...enemiesRef.current]);

        // --- Psychological Effects & Stress ---
        const dangerLevel = Math.max(0, 1 - closestEnemyDist / 30);
        setDanger(dangerLevel);
        
        stressRef.current = THREE.MathUtils.lerp(stressRef.current, dangerLevel * 100, 2 * delta);
        setStress(stressRef.current);

        // Heartbeat audio based on stress
        const heartbeatInterval = Math.max(0.3, 1.5 - (stressRef.current / 100));
        if (time - lastHeartbeatTime.current > heartbeatInterval) {
            playSound('heartbeat', 0, 0.2 + (stressRef.current / 100) * 0.8);
            lastHeartbeatTime.current = time;
        }

        // Random scare sounds
        if (dangerLevel > 0.5 && Math.random() < 0.005) {
            playSound('scare', closestEnemyDist, 0.8);
        }

        if (gameOver) {
            playSound('scare', 0, 2);
            document.exitPointerLock();
            setGameState('gameover');
        }
    });

    return (
        <>
            <fog attach="fog" args={['#020202', 2, 35]} />
            <ambientLight intensity={0.005} />
            
            {/* Player Flashlight - Very weak, cinematic */}
            <pointLight ref={lightRef} color="#aaddff" intensity={0.8} distance={15} decay={2.5} castShadow />
            <spotLight position={[0, 1.6, 0]} angle={0.5} penumbra={1} intensity={1} distance={20} color="#ffffff" target-position={[0, 1.6, -1]} />

            <PointerLockControls />

            {/* Echoes */}
            {echoes.map(echo => (
                <group key={echo.id} position={echo.position}>
                    <pointLight 
                        color="#00e5ff" 
                        intensity={echo.opacity * 20} 
                        distance={echo.radius * 1.2} 
                        decay={2}
                    />
                    <mesh>
                        <sphereGeometry args={[echo.radius, 64, 32]} />
                        <meshBasicMaterial 
                            color="#00e5ff" 
                            wireframe 
                            transparent 
                            opacity={echo.opacity * 0.3} 
                            blending={THREE.AdditiveBlending}
                            depthWrite={false}
                            side={THREE.DoubleSide}
                        />
                    </mesh>
                </group>
            ))}

            {/* Enemies */}
            {enemies.map(enemy => (
                <mesh key={enemy.id} position={enemy.position} rotation={enemy.rotation}>
                    {enemy.type === 'seeker' ? (
                        <octahedronGeometry args={[0.8, 0]} />
                    ) : (
                        <boxGeometry args={[0.8, 1.5, 0.8]} />
                    )}
                    <meshStandardMaterial 
                        color={enemy.state === 'hunting' ? '#ff0000' : '#550000'} 
                        emissive={enemy.state === 'hunting' ? '#ff0000' : '#220000'} 
                        emissiveIntensity={enemy.state === 'hunting' ? 2 : 0.5} 
                        wireframe={Math.random() > 0.5} // Glitchy visual
                        roughness={0.2}
                        metalness={0.8}
                    />
                </mesh>
            ))}

            {/* Walls */}
            <instancedMesh ref={wallsRef} args={[undefined, undefined, walls.length]} castShadow receiveShadow>
                <boxGeometry args={[1, 1, 1]} />
                <meshStandardMaterial color="#0a0a0a" roughness={0.9} metalness={0.1} />
            </instancedMesh>

            {/* Floor & Ceiling */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
                <planeGeometry args={[BOUNDS * 2.5, BOUNDS * 2.5]} />
                <meshStandardMaterial color="#030303" roughness={0.8} metalness={0.2} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 5, 0]} receiveShadow>
                <planeGeometry args={[BOUNDS * 2.5, BOUNDS * 2.5]} />
                <meshStandardMaterial color="#010101" roughness={1} />
            </mesh>
        </>
    );
}

export default function App() {
    const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover'>('menu');
    const [energy, setEnergy] = useState(100);
    const [stamina, setStamina] = useState(100);
    const [stress, setStress] = useState(0);
    const [danger, setDanger] = useState(0);

    const startGame = () => {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        setGameState('playing');
        setEnergy(100);
        setStamina(100);
        setStress(0);
        setDanger(0);
    };

    return (
        <div className="relative w-full h-screen bg-black overflow-hidden font-sans select-none text-gray-200">
            {gameState === 'playing' && (
                <>
                    <Canvas shadows camera={{ fov: 70 }}>
                        <GameScene 
                            setGameState={setGameState} 
                            setEnergy={setEnergy} 
                            setStamina={setStamina}
                            setStress={setStress}
                            setDanger={setDanger}
                        />
                        <EffectComposer>
                            <Noise opacity={0.04 + (stress / 100) * 0.1} blendFunction={BlendFunction.OVERLAY} />
                            <Vignette eskil={false} offset={0.1} darkness={1.2 + (stress / 100) * 0.5} />
                            <Bloom luminanceThreshold={0.1} luminanceSmoothing={0.9} intensity={0.5 + danger * 1.5} />
                            <ChromaticAberration offset={new THREE.Vector2(0.002 + danger * 0.01, 0.002 + danger * 0.01)} />
                        </EffectComposer>
                    </Canvas>
                    
                    {/* Minimalist UI */}
                    <div className="absolute inset-0 pointer-events-none z-10 flex flex-col justify-between p-8">
                        {/* Top HUD */}
                        <div className="flex justify-between items-start opacity-70">
                            <div className="flex flex-col gap-3 w-48">
                                {/* Energy */}
                                <div className="flex items-center gap-2">
                                    <Zap size={14} className="text-cyan-400" />
                                    <div className="flex-1 h-1 bg-gray-900 rounded-full overflow-hidden">
                                        <div className="h-full bg-cyan-400 transition-all duration-200" style={{ width: `${energy}%`, boxShadow: '0 0 8px #00e5ff' }} />
                                    </div>
                                </div>
                                {/* Stamina */}
                                <div className="flex items-center gap-2">
                                    <Footprints size={14} className="text-gray-400" />
                                    <div className="flex-1 h-1 bg-gray-900 rounded-full overflow-hidden">
                                        <div className="h-full bg-gray-300 transition-all duration-75" style={{ width: `${stamina}%` }} />
                                    </div>
                                </div>
                            </div>
                            
                            {/* Heartbeat / Stress Indicator */}
                            <motion.div 
                                animate={{ scale: [1, 1.1 + danger * 0.5, 1], opacity: 0.3 + danger * 0.7 }}
                                transition={{ repeat: Infinity, duration: Math.max(0.3, 1.5 - (stress / 100)) }}
                            >
                                <HeartPulse size={24} className={danger > 0.5 ? 'text-red-500' : 'text-gray-500'} />
                            </motion.div>
                        </div>

                        {/* Crosshair */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center opacity-30">
                            <div className="w-1 h-1 bg-white rounded-full" />
                        </div>

                        {/* Bottom HUD - Contextual Hints */}
                        <div className="text-center opacity-40 text-xs tracking-widest">
                            {stamina < 20 ? 'EXHAUSTED' : energy < 25 ? 'LOW ENERGY' : ''}
                        </div>
                    </div>

                    {/* Damage/Stress Vignette Overlay */}
                    <div 
                        className="absolute inset-0 pointer-events-none z-0 transition-opacity duration-300"
                        style={{ 
                            background: `radial-gradient(circle, transparent 40%, rgba(150,0,0,${danger * 0.3}) 100%)`,
                            opacity: danger > 0.2 ? 1 : 0
                        }}
                    />
                </>
            )}

            <AnimatePresence>
                {gameState === 'menu' && (
                    <motion.div 
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 1 } }}
                        className="absolute inset-0 flex flex-col items-center justify-center bg-[#050505] z-50"
                    >
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,229,255,0.05)_0%,transparent_50%)]" />
                        <motion.h1 
                            initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2, duration: 1 }}
                            className="text-6xl font-light tracking-[0.2em] mb-2 text-white"
                        >
                            ECHO DRIFT
                        </motion.h1>
                        <motion.p 
                            initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} transition={{ delay: 1, duration: 1 }}
                            className="text-sm tracking-widest mb-12"
                        >
                            SENSORY DEPRIVATION PROTOCOL
                        </motion.p>

                        <motion.button
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}
                            onClick={startGame}
                            className="px-8 py-3 border border-white/20 hover:bg-white hover:text-black transition-all duration-500 tracking-[0.3em] text-sm uppercase"
                        >
                            Initiate
                        </motion.button>

                        <motion.div 
                            initial={{ opacity: 0 }} animate={{ opacity: 0.3 }} transition={{ delay: 2 }}
                            className="absolute bottom-12 flex gap-12 text-xs tracking-widest"
                        >
                            <div className="flex flex-col items-center gap-2"><span>W A S D</span><span>MOVE</span></div>
                            <div className="flex flex-col items-center gap-2"><span>SHIFT</span><span>SPRINT</span></div>
                            <div className="flex flex-col items-center gap-2"><span>SPACE</span><span>ECHO PULSE</span></div>
                            <div className="flex flex-col items-center gap-2"><span>MOUSE</span><span>LOOK</span></div>
                        </motion.div>
                    </motion.div>
                )}

                {gameState === 'gameover' && (
                    <motion.div 
                        initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                        className="absolute inset-0 flex flex-col items-center justify-center bg-black z-50"
                    >
                        <h2 className="text-5xl font-light tracking-[0.3em] text-red-600 mb-8 blur-[1px]">SIGNAL LOST</h2>
                        <button
                            onClick={startGame}
                            className="px-8 py-3 border border-red-900/50 text-red-500 hover:bg-red-900/20 transition-all duration-300 tracking-[0.2em] text-sm uppercase"
                        >
                            Reconnect
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
