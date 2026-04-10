import * as THREE from 'three';

export function createRadarChart(data = [0.8, 0.7, 0.9, 0.6, 0.85, 0.75], maxRadius = 5, numSections = 6, labels = []) {
    const group = new THREE.Group();
    const angleStep = (Math.PI * 2) / numSections;
    const tubeRadius = 0.006;
    const gridColor = 0xFFFFFF;
    const dataColor = 0x089BDF;
    
    for (let i = 0; i < numSections; i++) {
        const angle = angleStep * i - Math.PI / 2;
        const endX = Math.cos(angle) * maxRadius;
        const endY = Math.sin(angle) * maxRadius;
        
        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(endX, endY, 0)
        ];
        const curve = new THREE.CatmullRomCurve3(points, false);
        
        const geometry = new THREE.TubeGeometry(curve, 2, tubeRadius, 8, false);
        const material = new THREE.MeshStandardMaterial({ color: gridColor });
        const tube = new THREE.Mesh(geometry, material);
        group.add(tube);
    }
    
    const levels = [0.2, 0.4, 0.6, 0.8, 1.0];
    levels.forEach(level => {
        const radius = maxRadius * level;
        
        for (let i = 0; i < numSections; i++) {
            const angle1 = (angleStep * i - Math.PI / 2);
            const angle2 = (angleStep * (i + 1) - Math.PI / 2);
            
            const point1 = new THREE.Vector3(
                Math.cos(angle1) * radius,
                Math.sin(angle1) * radius,
                0
            );
            const point2 = new THREE.Vector3(
                Math.cos(angle2) * radius,
                Math.sin(angle2) * radius,
                0
            );
            
            const points = [point1, point2];
            const curve = new THREE.CatmullRomCurve3(points, false);
            const geometry = new THREE.TubeGeometry(curve, 2, tubeRadius, 8, false);
            const material = new THREE.MeshStandardMaterial({ color: gridColor });
            const tube = new THREE.Mesh(geometry, material);
            group.add(tube);
        }
    });
    
    const fillVertices = [];
    const fillIndices = [];
    
    fillVertices.push(0, 0, 0);
    
    data.forEach((value, i) => {
        const angle = angleStep * i - Math.PI / 2;
        const radius = maxRadius * value;
        fillVertices.push(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
            0
        );
    });
    
    for (let i = 0; i < numSections; i++) {
        const next = (i + 1) % numSections;
        fillIndices.push(0, i + 1, next + 1);
    }
    
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute('position', new THREE.Float32BufferAttribute(fillVertices, 3));
    fillGeometry.setIndex(fillIndices);
    fillGeometry.computeVertexNormals();
    
    const fillMaterial = new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(0x089BDF) },
            uMaxRadius: { value: maxRadius }
        },
        vertexShader: `
            varying vec2 vPosition;
            void main() {
                vPosition = position.xy;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uColor;
            uniform float uMaxRadius;
            varying vec2 vPosition;
            void main() {
                float dist = length(vPosition);
                float normalizedDist = clamp(dist / uMaxRadius, 0.0, 1.0);
                float fresnel = pow(normalizedDist, 1.4);
                float pulse = 0.55 + 0.45 * sin(uTime * 1.2);
                float opacity = fresnel * pulse * 0.85 + 0.04;
                gl_FragColor = vec4(uColor, opacity);
            }
        `
    });
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    group.userData.fillMesh = fillMesh;
    group.add(fillMesh);
    
    for (let i = 0; i < numSections; i++) {
        const angle1 = angleStep * i - Math.PI / 2;
        const angle2 = angleStep * (i + 1) - Math.PI / 2;
        const value1 = data[i] || 0;
        const value2 = data[(i + 1) % numSections] || 0;
        
        const radius1 = maxRadius * value1;
        const radius2 = maxRadius * value2;
        
        const point1 = new THREE.Vector3(
            Math.cos(angle1) * radius1,
            Math.sin(angle1) * radius1,
            0
        );
        const point2 = new THREE.Vector3(
            Math.cos(angle2) * radius2,
            Math.sin(angle2) * radius2,
            0
        );
        
        const points = [point1, point2];
        const curve = new THREE.CatmullRomCurve3(points, false);
        const geometry = new THREE.TubeGeometry(curve, 2, tubeRadius * 2, 8, false);
        const material = new THREE.MeshStandardMaterial({ color: dataColor });
        const tube = new THREE.Mesh(geometry, material);
        group.add(tube);
    }
    
    data.forEach((value, i) => {
        const angle = angleStep * i - Math.PI / 2;
        const radius = maxRadius * value;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        
        const sphereGeometry = new THREE.SphereGeometry(tubeRadius * 4, 16, 16);
        const sphereMaterial = new THREE.MeshStandardMaterial({ color: dataColor });
        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
        sphere.position.set(x, y, 0);
        group.add(sphere);
    });
    
    if (labels && labels.length > 0) {
        labels.forEach((label, i) => {
            const angle = angleStep * i - Math.PI / 2;
            const labelRadius = maxRadius * 1.10;
            const x = Math.cos(angle) * labelRadius;
            const y = Math.sin(angle) * labelRadius;
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.width = 512;
            canvas.height = 128;
            
            // Function to draw label with font loading check
            const drawLabel = () => {
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.font = 'bold 64px Quantico, sans-serif';
                context.fillStyle = '#ffffff';
                context.textAlign = 'center';
                context.textBaseline = 'middle';
                context.fillText(label, canvas.width / 2, canvas.height / 2);
            };
            
            // Try to draw immediately
            drawLabel();
            
            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;
            
            const spriteMaterial = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                alphaTest: 0.1
            });
            
            const sprite = new THREE.Sprite(spriteMaterial);
            sprite.scale.set(2, 0.5, 1);
            sprite.position.set(x, y, 0);
            group.add(sprite);
            
            // If font not loaded, wait for it and redraw
            if (document.fonts) {
                const checkFont = async () => {
                    try {
                        await document.fonts.load('bold 64px Quantico');
                        drawLabel();
                        texture.needsUpdate = true;
                    } catch (e) {
                        // Font loading failed, keep current rendering
                        console.warn('Font loading failed:', e);
                    }
                };
                
                if (!document.fonts.check('bold 64px Quantico')) {
                    checkFont();
                }
            }
        });
    }
    
    group.rotation.x = -Math.PI / 1;    
    return group;
}
