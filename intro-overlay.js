import { typewriterRandom } from './text-animations.js';

const TARGET_ITEM = 'product designer';

function buildDialItems() {
    const others = [
        'rider',
        'traveler',
        'rabbit holer',
        'maker',
        'storyteller',
        'dot connector',
        'researcher',
        'gpu tinkerer',
        'vibe coder',
        'creative technologist'
    ];
    // Fisher-Yates shuffle
    for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [others[i], others[j]] = [others[j], others[i]];
    }
    // Insert product designer at center (index 5)
    others.splice(5, 0, TARGET_ITEM);
    return others;
}

const DIAL_ITEMS = buildDialItems();
const TARGET_INDEX = DIAL_ITEMS.indexOf(TARGET_ITEM);
const VISIBLE_ITEMS = 11; // items visible at once (center ± 5)
const SPIN_DURATION_MS = 1800;
const SETTLE_PAUSE_MS = 500;
const FADE_DURATION_MS = 600;
const FLY_TO_TRIGGER_MS = 1000;

let onFlyToCallback = null;
let overlayDone = false;

export function isOverlayActive() {
    return !overlayDone;
}

export function initIntroOverlay({ onFlyTo } = {}) {
    onFlyToCallback = onFlyTo || null;

    const overlay = document.getElementById('intro-overlay');
    const leftText = document.getElementById('intro-left-text');
    const dialTrack = document.getElementById('intro-dial-track');

    if (!overlay || !leftText || !dialTrack) return;

    // Build looped dial — repeat list 6x so scroll has plenty of runway
    const loopedItems = [];
    for (let i = 0; i < 6; i++) {
        DIAL_ITEMS.forEach(item => loopedItems.push(item));
    }

    // Target: land on TARGET_ITEM in the 3rd repetition (index ~2*11 + TARGET_INDEX)
    const targetLoopedIndex = 2 * DIAL_ITEMS.length + TARGET_INDEX;

    // Render dial items
    loopedItems.forEach((item, i) => {
        const el = document.createElement('div');
        el.className = 'intro-dial-item';
        el.dataset.index = i;
        el.textContent = item;
        dialTrack.appendChild(el);
    });

    // Read actual dimensions after DOM is rendered
    const firstItem = dialTrack.children[0];
    const ITEM_HEIGHT = firstItem ? firstItem.offsetHeight || 40 : 40;
    const dialWindowHeight = dialTrack.parentElement.offsetHeight || 600;
    const DIAL_CENTER_OFFSET = dialWindowHeight / 2 - ITEM_HEIGHT / 2;

    // Start scroll position so first visible item is near the top of the list
    const startIndex = 0;
    const finalOffset = -(targetLoopedIndex * ITEM_HEIGHT - DIAL_CENTER_OFFSET);
    const startOffset = -(startIndex * ITEM_HEIGHT - DIAL_CENTER_OFFSET);

    dialTrack.style.transform = `translateY(${startOffset}px)`;

    // Start left text write-on
    typewriterRandom(leftText, 'arshad woke up and chose to be a', 20);

    // Trigger fly-to at 1 second
    setTimeout(() => {
        onFlyToCallback?.();
    }, FLY_TO_TRIGGER_MS);

    // Animate dial spin
    const startTime = performance.now();

    function easeOutQuart(t) {
        return 1 - Math.pow(1 - t, 4);
    }

    function updateItemOpacities(currentOffset) {
        const centerFloat = (-currentOffset + DIAL_CENTER_OFFSET) / ITEM_HEIGHT;
        Array.from(dialTrack.children).forEach((el, i) => {
            const dist = Math.abs(i - centerFloat);
            let opacity = 0;
            if (dist < 0.5) opacity = 1;
            else if (dist < 1.5) opacity = 0.45;
            else if (dist < 2.5) opacity = 0.18;
            else opacity = 0;
            el.style.opacity = opacity;

            const scale = dist < 0.5 ? 1 : dist < 1.5 ? 0.92 : 0.85;
            el.style.transform = `scale(${scale})`;
        });
    }

    function animateDial(timestamp) {
        const elapsed = timestamp - startTime;
        const progress = Math.min(elapsed / SPIN_DURATION_MS, 1);
        const eased = easeOutQuart(progress);

        const currentOffset = startOffset + (finalOffset - startOffset) * eased;
        dialTrack.style.transform = `translateY(${currentOffset}px)`;

        updateItemOpacities(currentOffset);

        if (progress < 1) {
            requestAnimationFrame(animateDial);
        } else {
            // Settled — pause then fade out
            dialTrack.style.transform = `translateY(${finalOffset}px)`;
            updateItemOpacities(finalOffset);

            setTimeout(() => {
                fadeOutOverlay(overlay);
            }, SETTLE_PAUSE_MS);
        }
    }

    requestAnimationFrame(animateDial);
}

function fadeOutOverlay(overlay) {
    overlay.style.transition = `opacity ${FADE_DURATION_MS}ms ease`;
    overlay.style.opacity = '0';
    setTimeout(() => {
        overlay.style.display = 'none';
        overlayDone = true;
    }, FADE_DURATION_MS);
}
