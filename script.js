import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { createRadarChart } from './three-objects.js';
import { typewriterRandom } from './text-animations.js';

const APP_MODES = {
    IDLE: 'IDLE',
    JOURNEY_RUNNING: 'JOURNEY_RUNNING',
    JOURNEY_PAUSED_BY_POPUP: 'JOURNEY_PAUSED_BY_POPUP',
    PROJECTS_MODE: 'PROJECTS_MODE'
};

const JOURNEY_STEP_DURATION_MS = 7000;
const JOURNEY_FLY_DURATION_MS = 4000;
const JOURNEY_POPUP_AUTO_CLOSE_MS = 5000;
const PROJECT_FLIGHT_BASE_DURATION_MS = 2600;
const PROJECT_FLIGHT_PER_PROJECT_MS = 900;
const PROJECT_ENTRY_DURATION_MS = 1800;
const PROJECT_ENTRY_HANDOFF_EARLY_MS = 320;
const PROJECT_ENTRY_TO_PATH_BLEND_MS = 320;
const PROJECT_EXIT_STAGGER_MS = 200;
const PROJECT_MARKER_EXIT_DURATION_MS = 320;
const PROJECT_OVERVIEW_DURATION_MS = 2800;
const PROJECT_FLIGHT_ZOOM = 12;
const PROJECT_FLIGHT_PITCH = 30;
const PROJECT_OVERVIEW_PITCH = 60;
const PROJECT_OVERVIEW_BEARING = 80;
const PROJECT_OVERVIEW_BEARING_MOBILE = 20;
const PROJECT_OVERVIEW_ZOOM_OUT_DELTA = 1;
const PROJECT_OVERVIEW_BLEND_START_PROGRESS = 0.74;
const PROJECT_VIRTUAL_END_OVERSHOOT = 0.82;
const PROJECT_PATH_LOOKAHEAD = 0.48;
const PROJECT_BEARING_SMOOTHING = 0.2;
const POPUP_CLOSE_ANIMATION_MS = 260;
const FALLBACK_POPUP_IMAGE = '/portfolio-card.webp';

const map = new maplibregl.Map({
    container: 'map',
    zoom: 1,
    center: [77.5946, 12.9716],
    attributionControl: false,
    canvasContextAttributes: { antialias: true },
    style: {
        version: 8,
        projection: {
            type: 'globe'
        },
        sources: {
            satellite: {
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                // Esri has no z19 around Dehradun (St. Judes, Doon, Arshli Bridge) and a pitched
                // camera asks for one level more than the centre, so cap at 18 and let MapLibre stretch it
                maxzoom: 18,
                attribution: 'Esri, Maxar, Earthstar Geographics',
                type: 'raster'
            }
        },
        layers: [
            {
                id: 'Satellite',
                type: 'raster',
                source: 'satellite'
            }
        ],
        sky: {
            'sky-color': '#88C6FC',
            'sky-horizon-blend': 0.8,
            'horizon-color': '#ffffff',
            'horizon-fog-blend': 0.8,
            'fog-color': '#88C6FC',
            'fog-ground-blend': 0.5,
            'atmosphere-blend': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0, 1,
                1, 1,
                12, 0
            ]
        },
        light: {
            anchor: 'map',
            position: [1, 90, 40]
        }
    }
});

let mapViewportRefreshTimer = null;
function queueMapViewportRefresh(delayMs = 120) {
    if (mapViewportRefreshTimer) {
        clearTimeout(mapViewportRefreshTimer);
    }

    mapViewportRefreshTimer = setTimeout(() => {
        map.resize();
        map.triggerRepaint();
        mapViewportRefreshTimer = null;
    }, delayMs);
}

window.addEventListener('resize', () => queueMapViewportRefresh(120));
window.addEventListener('orientationchange', () => queueMapViewportRefresh(280));
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => queueMapViewportRefresh(120));
}

let appMode = APP_MODES.IDLE;
let isRotating = false;
let isInteracting = false;
const rotationSpeed = 0.0001;
let currentLng = 77.5946;
const initialLat = 12.9716;

let isJourneyActive = false;
let isJourneyPausedByPopup = false;
let journeyTimeout = null;
let currentJourneyIndex = 0;
let journeyStepStartedAt = null;
let journeyRemainingMs = JOURNEY_STEP_DURATION_MS;

let progressAnimationFrame = null;
let progressStartTimestamp = null;
let progressTotalDuration = 0;
let progressElapsedOffset = 0;

let activeJourneyPopup = null;
let journeyPopupAutoCloseTimer = null;
let journeyStagePopupTimer = null;
let isReplacingJourneyPopup = false;
const journeyPopupMeta = new WeakMap();
const journeyPopupCleanupHandlers = new Map();

const activeProjectPopups = new Set();
const activeProjectPopupById = new Map();
const projectMarkers = [];
const journeyMarkers = [];
const visibleProjectMarkerIds = new Set();
let projectFlightAnimationFrame = null;
let projectEntryHandoffTimer = null;
let projectExitSequenceTimers = [];
let projectExitSequenceToken = 0;
let projectDetailModalCleanupTimer = null;
let projectTextRotationInterval = null;

let textRotationInterval = null;
let idleTimer = null;
const IDLE_DELAY = 5000;
const ROTATION_INTERVAL = 5000;

const journey = [
    {
        name: 'Dehradun',
        coords: [78.04187306639645, 30.324297991273333],
        description: 'Born in the foothills.',
        image: 'dehradun.webp',
        date: '1996',
        zoom: 12,
        bearing: 30,
        pitch: 60,
        wikipedia: 'Dehradun'
    },
    {
        name: 'St. Judes School',
        coords: [77.99574241813566, 30.292694730933373],
        description: 'Schooling at St. Judes. Proud Thaddeusian.',
        image: 'stjudes.webp',
        date: '2015',
        zoom: 18,
        bearing: -30,
        pitch: 0,
        customUrl: 'https://www.schoolsofdehradun.com/school/st-judes-school/'
    },
    {
        name: 'Doon Business School',
        coords: [77.8632908995369, 30.37684055270396],
        description: 'Business degree. Mostly figuring myself out.',
        image: 'doonbusiness.webp',
        date: '2015-2018',
        zoom: 17,
        bearing: 120,
        pitch: 45,
        customUrl: 'https://www.doonbusinessschool.com/'
    },
    {
        name: 'Presidency University',
        coords: [77.53514820072209, 13.168697802405879],
        description: 'Moved to Bangalore for an MBA. The city stuck.',
        image: 'presidency-university.webp',
        date: '2018-2020',
        zoom: 17,
        bearing: 0,
        pitch: 0,
        wikipedia: 'Presidency_University,_Bengaluru'
    },
    {
        name: 'Teamlease',
        coords: [77.62494594852494, 12.94052546680988],
        description: 'First job: sales.',
        image: 'teamlease.webp',
        date: '2020-2021',
        zoom: 17,
        bearing: 180,
        pitch: 0,
        wikipedia: 'TeamLease_Services'
    },
    {
        name: 'Ignitho / Piqual',
        coords: [77.650889974173, 12.920106662087223],
        description: 'First design job, remote, mid-COVID.',
        image: 'ignitho.webp',
        date: 'Jan 2021 - Nov 2021',
        zoom: 18,
        bearing: 0,
        pitch: 20,
        customUrl: 'https://www.ignitho.com/'
    },
    {
        name: 'Aereo',
        coords: [77.6042, 13.0725],
        description: 'Where I fell for maps.',
        image: 'aereo.webp',
        date: 'Nov 2021 - Present',
        zoom: 17,
        bearing: 180,
        pitch: 0,
        customUrl: 'https://aereo.io/'
    },
    {
        name: 'Pondicherry',
        coords: [79.83074593230793, 11.902762125054846],
        description: 'Biked Bangalore to Pondicherry.',
        image: 'pondicherry.webp',
        date: 'Stuff I find interesting',
        zoom: 14,
        bearing: 0,
        pitch: 45,
        wikipedia: 'Puducherry_(union_territory)'
    },
    {
        name: 'Arshli Bridge',
        coords: [77.80306340271673, 30.556156968139717],
        description: 'Found a bridge missing from Maps. Added it, named it.',
        image: 'arshlibridge.webp',
        date: 'Stuff I find interesting',
        zoom: 18,
        bearing: 180,
        pitch: 0,
        customUrl: 'https://maps.app.goo.gl/CpAs1FfMCEioi442A',
        linkLabel: 'VIEW ON GOOGLE MAPS'
    }
];

const projectsData = [
    {
        id: 'project-b',
        markerLabel: '01',
        title: 'AEREO CLOUD',
        description: 'Production web-GIS platform for mining and drone survey teams. I set up the experimental environment, worked on-site with mine operators, and defined the specs engineering built from.',
        image: '/aereo-cloud.webp',
        detailImage: '/aereo-cloud-cover.webp',
        linkUrl: 'https://github.com/arshlibruh-code',
        linkLabel: 'VIEW PROJECT',
        linkBehavior: 'modal',
        focusTags: ['UX', 'MAPS', '3D WORKFLOWS'],
        hideTitle: true,
        showDetailTags: false,
        intro: 'Aereo Cloud is a production web-GIS platform for mining and drone survey teams. For nearly five years I have designed it end to end: research on mine sites, the specs engineering builds from, and the design system underneath. Three stories carry most of it.',
        sections: [
            {
                heading: 'Context',
                body: 'The users are technical specialists: surveyors, mine planners, field operators. The interface is structured data: point clouds, terrain, coordinate systems, 3D views. The team is 20+ engineers, PMs and data scientists.'
            },
            {
                heading: '1. Desktop GIS, in a browser',
                body: 'Work that needed Global Mapper and AutoCAD on expensive hardware now runs in a browser, on any device, with no setup. I wrote the specs for point cloud tools, DXF support and terrain analysis, backed by competitive research across Propeller, Strayos, Maptek and Datamine.'
            },
            {
                heading: '2. Drones instead of walking the pile',
                body: 'On site visits with mining and survey teams I watched stockpiles measured by walking them with DGPS. We replaced that with drone-based volumetrics processed in the cloud, accurate from the office.'
            },
            {
                heading: '3. An experiments lane before the sprint',
                body: 'Engineering wanted everything through the sprint; product wanted to move faster than it. I set up and run an experimental environment where ideas ship in code on real data to beta users and pass a go/no-go gate before they enter the sprint.'
            },
            {
                heading: 'Underneath',
                body: '3D camera orchestration, underground views and multi-step digitization, defined as interaction models and built as state machines rather than left as specs. A design system, UX process and research practice set up from zero and scaled across three products. Aereo Go put live map data on the phones field operators already carried, replacing printed maps.'
            }
        ],
        myRole: 'Product designer, end to end: field research, specs, interaction models, the design system, and prototypes in code on real data. I lead a small design team of full-time designers and interns.',
        stack: 'MapLibre, Three.js, JavaScript, Vite, HTML/CSS',
        impactPlaceholders: [
            'Desktop GIS workflows moved into the browser',
            'DGPS walkdowns replaced by drone volumetrics',
            'One design system across three products'
        ],
        coords: [74.84063987209015, 12.811350045276598]
    },
    {
        id: 'project-g',
        markerLabel: '02',
        title: 'AI TEAMMATE',
        description: 'An AI teammate our developers are piloting. Hand it a Jira ticket in Slack: it asks before it assumes, writes the analysis, opens the merge requests, and stops at two human review gates. It never merges.',
        image: '/ai-teammate.webp',
        video: '/ai-teammate.mp4',
        detailImage: '/ai-teammate.webp',
        linkLabel: 'VIEW PROJECT',
        linkBehavior: 'modal',
        focusTags: ['AI', 'WORKFLOW', 'HUMAN IN THE LOOP'],
        showDetailTags: false,
        intro: 'An AI teammate for a product team. Hand it a Jira ticket in its Slack channel and it carries the work toward reviewed code, one thread per ticket. It is in pilot with our developers on real features.',
        sections: [
            {
                heading: 'Context',
                body: 'Most of a small team\'s time goes into the middle of a ticket: working out what was meant, writing the plan, wiring the change across repos. That middle is where an agent can help, as long as people stay in charge of it.'
            },
            {
                heading: 'Problem',
                body: 'An agent that writes code is easy to build and hard to trust. The design problem was not what it can do, but where it should stop, and how a person knows what it is doing without watching it.'
            },
            {
                heading: 'How a ticket moves',
                body: 'Every ticket walks the same path: read, ask, analyse, build. It asks clarifying questions before it assumes, writes its analysis for review, and only then writes code. Every step shows up in the same Slack thread.'
            },
            {
                heading: 'Design decisions',
                body: 'It never merges: a person clicks merge, always. It stops at two review gates, before the code and after it, and waits at both. It only counts a review as done when someone replies in the thread, so approval is always a visible act. It reads the product\'s own manuals, so it never asks the team what an iteration is.'
            },
            {
                heading: 'Where it is now',
                body: 'In pilot with our developers on real features. The details are better on a call.'
            }
        ],
        myRole: 'I designed the workflow: the states a ticket moves through, the two human gates, the persona, and what it is and is not allowed to do.',
        coords: [74.81237025960675, 12.896946186306437]
    },
    {
        id: 'project-d',
        markerLabel: '03',
        title: 'HOLISION',
        video: '/holision.mp4',
        imagePosition: 'center bottom',
        description: 'Live terrain cut and fill in the browser. Real elevation tiles streamed and decoded, custom GLSL shaders, contours and volumes computed as you work.',
        image: '/holision.webp',
        linkUrl: 'https://holision.pages.dev',
        linkLabel: 'VIEW LIVE',
        focusTags: ['TERRAIN', 'THREE.JS', 'GLSL'],
        coords: [74.79382795128464, 12.985018764409375]
    },
    {
        id: 'project-c',
        markerLabel: '04',
        title: 'MBRT',
        imagePosition: 'center bottom',
        description: 'NLP to 6 specialized map agents. Natural language drives routes, isochrones, buffers, polygons, and elevation profiles, all live in Mapbox.',
        image: '/mbrt.webp',
        linkUrl: 'https://github.com/arshlibruh-code/MBRT',
        linkLabel: 'VIEW ON GITHUB',
        focusTags: ['AI', 'MAPS', 'NLP'],
        coords: [74.77493613634593, 13.073059748410813]
    },
    {
        id: 'project-a',
        markerLabel: '05',
        title: 'This Portfolio',
        description: 'A spatial portfolio experience built around story, interaction, and camera choreography to showcase my journey and projects.',
        image: '/portfolio-card.webp',
        linkLabel: 'CURRENTLY VIEWING',
        linkBehavior: 'here',
        focusTags: ['UX', 'INTERACTION', 'MAPS', '3D'],
        coords: [74.75505299252845, 13.160927390140543]
    }
];

const dynamicTexts = [
    'I design tools for maps, 3D and data.',
    'I start where the work happens, not on a screen.',
    'Orchestrating agents ✽ designing the handoff.',
    'I make GPUs do weird things.',
    'product design ✽ film ✽ whatever\'s interesting.',
];
let currentTextIndex = 0;

const PROJECT_MODE_TEXT = 'Things I\'ve built and shipped.';

function rotateGlobe() {
    if (!isRotating || isInteracting) {
        return;
    }

    currentLng += rotationSpeed;
    if (currentLng > 180) currentLng -= 360;
    if (currentLng < -180) currentLng += 360;

    map.setCenter([currentLng, initialLat]);
    requestAnimationFrame(rotateGlobe);
}

function handleInteractionStart() {
    if (isRotating) {
        isRotating = false;
        isInteracting = true;
        const toggleButton = document.getElementById('rotation-toggle');
        if (toggleButton) {
            toggleButton.textContent = 'START';
        }
    }
}

map.on('mousedown', handleInteractionStart);
map.on('touchstart', handleInteractionStart);
map.on('wheel', handleInteractionStart);
map.on('dragstart', handleInteractionStart);

let journeyDragResumeTimer = null;

map.on('dragstart', () => {
    if (journeyDragResumeTimer) {
        clearTimeout(journeyDragResumeTimer);
        journeyDragResumeTimer = null;
    }
    if (isJourneyActive && !isJourneyPausedByPopup) {
        pauseJourneyForPopup();
    }
});

map.on('dragend', () => {
    if (!isJourneyActive || !isJourneyPausedByPopup) {
        return;
    }
    journeyDragResumeTimer = setTimeout(() => {
        journeyDragResumeTimer = null;
        if (isJourneyActive && isJourneyPausedByPopup) {
            resumeJourneyFromPopup();
        }
    }, 300);
});

function normalizeAssetPath(assetPath) {
    if (!assetPath) {
        return FALLBACK_POPUP_IMAGE;
    }

    return assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
}

function ensureProjectDetailModalElements() {
    let modal = document.getElementById('project-detail-modal');
    let detailDiv = document.getElementById('project-detail-div');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'project-detail-modal';
        modal.className = 'project-detail-modal';
        modal.setAttribute('aria-hidden', 'true');

        detailDiv = document.createElement('div');
        detailDiv.id = 'project-detail-div';
        detailDiv.className = 'project-detail-div';

        modal.appendChild(detailDiv);
        document.body.appendChild(modal);
    } else if (!detailDiv) {
        detailDiv = document.createElement('div');
        detailDiv.id = 'project-detail-div';
        detailDiv.className = 'project-detail-div';
        modal.appendChild(detailDiv);
    }

    if (!modal.dataset.boundHandlers) {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeProjectDetailModal();
            }
        });
        modal.dataset.boundHandlers = '1';
    }

    return { modal, detailDiv };
}

function clearProjectDetailModalCleanupTimer() {
    if (projectDetailModalCleanupTimer) {
        clearTimeout(projectDetailModalCleanupTimer);
        projectDetailModalCleanupTimer = null;
    }
}

function refreshMapViewport(options = {}) {
    const { delayedMs = 0 } = options;

    const runRefresh = () => {
        requestAnimationFrame(() => {
            map.resize();
            map.triggerRepaint();
        });
    };

    runRefresh();

    if (delayedMs > 0) {
        setTimeout(runRefresh, delayedMs);
    }
}

function isProjectDetailModalOpen() {
    const modal = document.getElementById('project-detail-modal');
    return Boolean(modal && modal.classList.contains('is-open'));
}

function openProjectDetailModal(project) {
    gtag('event', 'project_detail_open', { project_id: project?.id });
    const { modal, detailDiv } = ensureProjectDetailModalElements();

    clearProjectDetailModalCleanupTimer();
    detailDiv.innerHTML = '';
    detailDiv.dataset.projectId = project?.id || '';

    const closeButton = document.createElement('button');
    closeButton.className = 'project-detail-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close project detail');
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeProjectDetailModal();
    });
    detailDiv.appendChild(closeButton);

    const content = document.createElement('div');
    content.className = 'project-detail-content';

    const heroImage = document.createElement('img');
    heroImage.className = 'project-detail-hero';
    heroImage.src = normalizeAssetPath(project?.detailImage || project?.image);
    heroImage.alt = project?.title ? `${project.title} image` : 'Project image';
    heroImage.loading = 'eager';
    heroImage.onerror = () => {
        if (heroImage.src.endsWith(FALLBACK_POPUP_IMAGE)) {
            return;
        }

        heroImage.src = FALLBACK_POPUP_IMAGE;
    };

    const contentSection = document.createElement('section');
    contentSection.className = 'project-detail-section';

    const heading = document.createElement('h2');
    heading.className = 'project-detail-title';
    heading.textContent = project?.title || 'Project';
    if (project?.hideTitle) heading.style.display = 'none';

    const subtitle = typeof project?.subtitle === 'string' ? project.subtitle : '';
    const introText = typeof project?.intro === 'string'
        ? project.intro
        : (project?.description || 'Project details coming soon.');
    const sectionBlocks = Array.isArray(project?.sections) ? project.sections : [];
    const focusTags = Array.isArray(project?.focusTags) ? project.focusTags : [];
    const shouldShowDetailTags = focusTags.length > 0 && project?.showDetailTags !== false;

    contentSection.appendChild(heading);

    if (subtitle) {
        const subtitleElement = document.createElement('p');
        subtitleElement.className = 'project-detail-subtitle';
        subtitleElement.textContent = subtitle;
        contentSection.appendChild(subtitleElement);
    }

    if (shouldShowDetailTags) {
        const tags = document.createElement('div');
        tags.className = 'project-detail-tags';

        focusTags.forEach((tag) => {
            const tagElement = document.createElement('span');
            tagElement.className = 'project-detail-tag';
            tagElement.textContent = tag;
            tags.appendChild(tagElement);
        });

        contentSection.appendChild(tags);
    }

    const intro = document.createElement('p');
    intro.className = 'project-detail-intro';
    intro.innerHTML = introText;
    contentSection.appendChild(intro);

    const story = document.createElement('div');
    story.className = 'project-detail-story';

    sectionBlocks.forEach((section) => {
        if (!section?.heading && !section?.body) {
            return;
        }

        const block = document.createElement('article');
        block.className = 'project-detail-block';

        if (section?.heading) {
            const blockHeading = document.createElement('h3');
            blockHeading.className = 'project-detail-block-heading';
            blockHeading.textContent = section.heading;
            block.appendChild(blockHeading);
        }

        if (section?.body) {
            const blockBody = document.createElement('p');
            blockBody.className = 'project-detail-block-body';
            blockBody.textContent = section.body;
            block.appendChild(blockBody);
        }

        story.appendChild(block);
    });

    if (project?.myRole) {
        const roleBlock = document.createElement('article');
        roleBlock.className = 'project-detail-block';

        const roleHeading = document.createElement('h3');
        roleHeading.className = 'project-detail-block-heading';
        roleHeading.textContent = 'My Role';

        const roleBody = document.createElement('p');
        roleBody.className = 'project-detail-block-body';
        roleBody.textContent = project.myRole;

        roleBlock.appendChild(roleHeading);
        roleBlock.appendChild(roleBody);
        story.appendChild(roleBlock);
    }

    const impacts = Array.isArray(project?.impactPlaceholders) ? project.impactPlaceholders : [];
    if (impacts.length > 0) {
        const impactBlock = document.createElement('article');
        impactBlock.className = 'project-detail-block';

        const impactHeading = document.createElement('h3');
        impactHeading.className = 'project-detail-block-heading';
        impactHeading.textContent = 'Impact';

        const impactList = document.createElement('ul');
        impactList.className = 'project-detail-impact-list';

        impacts.forEach((item) => {
            const impactItem = document.createElement('li');
            impactItem.className = 'project-detail-impact-item';
            impactItem.textContent = item;
            impactList.appendChild(impactItem);
        });

        impactBlock.appendChild(impactHeading);
        impactBlock.appendChild(impactList);
        story.appendChild(impactBlock);
    }

    if (story.childElementCount > 0) {
        contentSection.appendChild(story);
    }

    if (project?.wipNotice) {
        const wipCard = document.createElement('section');
        wipCard.className = 'project-detail-wip-card';

        const wipText = document.createElement('p');
        wipText.className = 'project-detail-wip-text';
        wipText.textContent = String(project.wipNotice).toUpperCase();

        wipCard.appendChild(wipText);
        contentSection.appendChild(wipCard);
    }

    content.appendChild(heroImage);
    content.appendChild(contentSection);
    detailDiv.appendChild(content);

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    refreshMapViewport({ delayedMs: 260 });
}

function closeProjectDetailModal() {
    const modal = document.getElementById('project-detail-modal');
    const detailDiv = document.getElementById('project-detail-div');

    if (!modal) {
        return;
    }

    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    refreshMapViewport({ delayedMs: 360 });

    if (detailDiv) {
        clearProjectDetailModalCleanupTimer();
        projectDetailModalCleanupTimer = setTimeout(() => {
            if (!modal.classList.contains('is-open')) {
                detailDiv.innerHTML = '';
                detailDiv.dataset.projectId = '';
            }

            projectDetailModalCleanupTimer = null;
            refreshMapViewport();
        }, 320);
    }
}

function truncateText(text, maxLength = 160) {
    if (!text) {
        return '';
    }

    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, maxLength - 1).trim()}...`;
}

function resolveJourneyLink(point) {
    if (point.customUrl) {
        return point.customUrl;
    }

    if (point.wikipedia) {
        return `https://en.wikipedia.org/wiki/${encodeURIComponent(point.wikipedia)}`;
    }

    return `https://maps.google.com/?q=${point.coords[1]},${point.coords[0]}`;
}

function resolveJourneyLinkLabel(point) {
    if (point.linkLabel) {
        return point.linkLabel;
    }

    if (point.customUrl) {
        return 'Visit Website';
    }

    if (point.wikipedia) {
        return 'Read More';
    }

    return 'Open in Maps';
}

function resolveJourneyImage(point) {
    if (point.image) {
        return normalizeAssetPath(point.image);
    }

    if (point.localImages && point.localImages.length > 0) {
        return normalizeAssetPath(point.localImages[0]);
    }

    return FALLBACK_POPUP_IMAGE;
}

function createPopupCard(data, options = {}) {
    const {
        showCloseButton = false,
        onRequestClose = null,
        variant = ''
    } = options;

    const card = document.createElement('article');
    card.className = variant ? `info-popup-card is-${variant}` : 'info-popup-card';

    if (showCloseButton) {
        const closeButton = document.createElement('button');
        closeButton.className = 'info-popup-close';
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label', 'Close popup');
        closeButton.innerHTML = '&times;';
        closeButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            onRequestClose?.();
        });
        card.appendChild(closeButton);
    }

    const image = document.createElement('img');
    image.className = 'info-popup-image';
    image.src = normalizeAssetPath(data.image);
    if (data.imagePosition) {
        image.style.objectPosition = data.imagePosition;
    }
    image.alt = data.title || 'Preview';
    image.loading = 'lazy';
    image.onerror = () => {
        if (image.src.endsWith(FALLBACK_POPUP_IMAGE)) {
            return;
        }

        image.src = FALLBACK_POPUP_IMAGE;
    };

    const body = document.createElement('div');
    body.className = 'info-popup-body';

    const title = document.createElement('h3');
    title.className = 'info-popup-title';
    title.textContent = data.title || 'Untitled';

    body.appendChild(title);

    const focusTags = Array.isArray(data.focusTags) ? data.focusTags : [];
    const metaParts = [
        data.date,
        data.tag,
        ...focusTags
    ].filter(Boolean);

    if (metaParts.length > 0) {
        const meta = document.createElement('div');
        meta.className = 'info-popup-meta';
        meta.textContent = metaParts.join(' • ');
        body.appendChild(meta);
    }

    if (!data.hideDescription) {
        const description = document.createElement('p');
        description.className = 'info-popup-description';
        description.textContent = truncateText(data.description, 160);
        body.appendChild(description);
    }

    if (data.linkBehavior === 'here') {
        // You're already inside it: a label, not a link
        const here = document.createElement('span');
        here.className = 'info-popup-link';
        here.style.cursor = 'default';
        here.textContent = data.linkLabel || 'CURRENTLY VIEWING';
        body.appendChild(here);
    } else if (data.linkUrl || data.linkBehavior === 'modal') {
        const cta = document.createElement('a');
        cta.className = 'info-popup-link';
        cta.href = data.linkBehavior === 'modal' ? '#' : data.linkUrl;
        cta.textContent = data.linkLabel || 'Open Link';

        if (data.linkBehavior === 'modal') {
            cta.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                openProjectDetailModal(data);
            });
        } else {
            cta.target = '_blank';
            cta.rel = 'noopener noreferrer';
        }

        body.appendChild(cta);
    }

    // A short silent loop replaces the still when the card has one; the still stays as
    // its poster, and visitors with reduced motion keep the still
    if (data.video && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const video = document.createElement('video');
        video.className = 'info-popup-image';
        video.src = normalizeAssetPath(data.video);
        video.poster = image.src;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'none';
        video.setAttribute('aria-label', data.title || 'Preview');
        card.appendChild(video);
        // Start only once the camera has landed, so decoding never competes with the flight,
        // and only one card plays at a time
        const startWhenStill = () => {
            if (!video.isConnected) {
                return;
            }
            if (map.isMoving()) {
                map.once('moveend', startWhenStill);
                return;
            }
            document.querySelectorAll('video.info-popup-image').forEach((other) => {
                if (other !== video) {
                    other.pause();
                }
            });
            video.play().catch(() => {});
        };
        setTimeout(startWhenStill, 400);
    } else {
        card.appendChild(image);
    }
    card.appendChild(body);

    return card;
}

function animatePopupCardOpen(cardElement) {
    if (!cardElement) {
        return;
    }

    requestAnimationFrame(() => {
        cardElement.classList.add('is-open');
    });
}

function removePopupWithAnimation(popup, options = {}) {
    if (!popup) {
        return;
    }

    const { duration = POPUP_CLOSE_ANIMATION_MS } = options;
    const popupElement = popup.getElement?.();
    const cardElement = popupElement?.querySelector('.info-popup-card');

    if (!popupElement || !cardElement) {
        popup.remove();
        return;
    }

    if (popupElement.dataset.closing === '1') {
        return;
    }

    popupElement.dataset.closing = '1';
    cardElement.classList.remove('is-open');
    cardElement.classList.add('is-closing');

    setTimeout(() => {
        popup.remove();
    }, duration);
}

function clearJourneyStagePopupTimer() {
    if (journeyStagePopupTimer) {
        clearTimeout(journeyStagePopupTimer);
        journeyStagePopupTimer = null;
    }
}

function clearProjectExitSequenceTimers() {
    projectExitSequenceToken += 1;

    if (projectExitSequenceTimers.length === 0) {
        return;
    }

    projectExitSequenceTimers.forEach((timer) => clearTimeout(timer));
    projectExitSequenceTimers = [];
}

function clearProjectEntryHandoffTimer() {
    if (projectEntryHandoffTimer) {
        clearTimeout(projectEntryHandoffTimer);
        projectEntryHandoffTimer = null;
    }
}

function stopProjectFlight() {
    clearProjectEntryHandoffTimer();

    if (projectFlightAnimationFrame) {
        cancelAnimationFrame(projectFlightAnimationFrame);
        projectFlightAnimationFrame = null;
    }
}

function catmullRom1D(p0, p1, p2, p3, t) {
    const v0 = (p2 - p0) * 0.5;
    const v1 = (p3 - p1) * 0.5;
    const t2 = t * t;
    const t3 = t2 * t;

    return (
        (2 * p1 - 2 * p2 + v0 + v1) * t3 +
        (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 +
        v0 * t +
        p1
    );
}

function interpolatePath(pathPoints, progress) {
    if (pathPoints.length === 0) {
        return [0, 0];
    }

    if (pathPoints.length === 1) {
        return pathPoints[0];
    }

    const clampedProgress = Math.max(0, Math.min(1, progress));
    const segmentCount = pathPoints.length - 1;
    const segmentPosition = clampedProgress * segmentCount;
    const segmentIndex = Math.min(segmentCount - 1, Math.floor(segmentPosition));
    const t = segmentPosition - segmentIndex;

    const p0 = pathPoints[Math.max(0, segmentIndex - 1)];
    const p1 = pathPoints[segmentIndex];
    const p2 = pathPoints[Math.min(pathPoints.length - 1, segmentIndex + 1)];
    const p3 = pathPoints[Math.min(pathPoints.length - 1, segmentIndex + 2)];

    return [
        catmullRom1D(p0[0], p1[0], p2[0], p3[0], t),
        catmullRom1D(p0[1], p1[1], p2[1], p3[1], t)
    ];
}

function calculateBearing(fromCoords, toCoords) {
    const lng1 = (fromCoords[0] * Math.PI) / 180;
    const lat1 = (fromCoords[1] * Math.PI) / 180;
    const lng2 = (toCoords[0] * Math.PI) / 180;
    const lat2 = (toCoords[1] * Math.PI) / 180;

    const y = Math.sin(lng2 - lng1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(lng2 - lng1);

    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function easeInOutCubic(t) {
    return t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function interpolateBearing(current, target, smoothing) {
    const delta = ((((target - current) % 360) + 540) % 360) - 180;
    return (current + (delta * smoothing) + 360) % 360;
}

function interpolateBearingByProgress(start, target, progress) {
    const delta = ((((target - start) % 360) + 540) % 360) - 180;
    return (start + (delta * progress) + 360) % 360;
}

function lerp(start, end, progress) {
    return start + ((end - start) * progress);
}

function toLngLatArray(center) {
    if (!center) {
        return null;
    }

    if (Array.isArray(center) && center.length >= 2) {
        return [center[0], center[1]];
    }

    if (typeof center.lng === 'number' && typeof center.lat === 'number') {
        return [center.lng, center.lat];
    }

    return null;
}

function getProjectFlightPathPoints() {
    const realPathPoints = projectsData.map((project) => project.coords);
    if (realPathPoints.length < 2) {
        return realPathPoints;
    }

    const lastPoint = realPathPoints[realPathPoints.length - 1];
    const prevPoint = realPathPoints[realPathPoints.length - 2];
    const virtualPoint = [
        lastPoint[0] + ((lastPoint[0] - prevPoint[0]) * PROJECT_VIRTUAL_END_OVERSHOOT),
        lastPoint[1] + ((lastPoint[1] - prevPoint[1]) * PROJECT_VIRTUAL_END_OVERSHOOT)
    ];

    return [...realPathPoints, virtualPoint];
}

function getProjectOverviewTarget() {
    if (typeof map.cameraForBounds !== 'function') {
        return null;
    }

    const isMobile = window.innerWidth <= 640;
    const overviewBearing = isMobile ? PROJECT_OVERVIEW_BEARING_MOBILE : PROJECT_OVERVIEW_BEARING;

    const camera = map.cameraForBounds(getProjectBounds(), {
        padding: {
            top: 80,
            bottom: 120,
            left: 80,
            right: 80
        },
        bearing: overviewBearing,
        pitch: PROJECT_OVERVIEW_PITCH
    });

    if (!camera) {
        return null;
    }

    const center = toLngLatArray(camera.center);
    if (!center) {
        return null;
    }

    return {
        center,
        zoom: Math.max(0, (camera.zoom ?? PROJECT_FLIGHT_ZOOM) - PROJECT_OVERVIEW_ZOOM_OUT_DELTA),
        pitch: PROJECT_OVERVIEW_PITCH,
        bearing: overviewBearing
    };
}

function getProjectBounds() {
    const bounds = new maplibregl.LngLatBounds();
    projectsData.forEach((project) => {
        bounds.extend(project.coords);
    });
    return bounds;
}

function createMarkerElement(labelOrSvg) {
    const el = document.createElement('div');
    el.className = 'journey-marker';
    el.style.cssText = `
        width: 24px;
        height: 24px;
        background-color: #223B68;
        border: 2px solid #089BDF;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Quantico', sans-serif;
        font-size: 14px;
        font-weight: bold;
        color: #ffffff;
        text-transform: uppercase;
        box-sizing: border-box;
    `;

    if (labelOrSvg && labelOrSvg.includes && labelOrSvg.includes('<svg')) {
        el.innerHTML = labelOrSvg;
    } else {
        el.textContent = labelOrSvg;
    }

    return el;
}

function attachPopupInteractionHandlers(container, handlers) {
    if (!container) {
        return () => {};
    }

    let isPointerInside = false;
    let isFocusedInside = false;

    const notifyStart = () => {
        handlers?.onInteractionStart?.();
    };

    const notifyEndIfIdle = () => {
        if (!isPointerInside && !isFocusedInside) {
            handlers?.onInteractionEnd?.();
        }
    };

    const onMouseEnter = () => {
        isPointerInside = true;
        notifyStart();
    };

    const onMouseLeave = () => {
        isPointerInside = false;
        notifyEndIfIdle();
    };

    const onFocusIn = () => {
        isFocusedInside = true;
        notifyStart();
    };

    const onFocusOut = () => {
        requestAnimationFrame(() => {
            isFocusedInside = container.contains(document.activeElement);
            notifyEndIfIdle();
        });
    };

    const onTouchStart = () => {
        notifyStart();
    };

    const onTouchEnd = () => {
        notifyEndIfIdle();
    };

    container.addEventListener('mouseenter', onMouseEnter);
    container.addEventListener('mouseleave', onMouseLeave);
    container.addEventListener('focusin', onFocusIn);
    container.addEventListener('focusout', onFocusOut);
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    container.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
        container.removeEventListener('mouseenter', onMouseEnter);
        container.removeEventListener('mouseleave', onMouseLeave);
        container.removeEventListener('focusin', onFocusIn);
        container.removeEventListener('focusout', onFocusOut);
        container.removeEventListener('touchstart', onTouchStart);
        container.removeEventListener('touchend', onTouchEnd);
        container.removeEventListener('touchcancel', onTouchEnd);
    };
}

function updateProgressBar(progress) {
    const progressBar = document.querySelector('.journey-progress-bar');
    if (!progressBar) {
        return;
    }

    progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
}

function stopProgressAnimation(resetBar = true) {
    if (progressAnimationFrame) {
        cancelAnimationFrame(progressAnimationFrame);
        progressAnimationFrame = null;
    }

    progressStartTimestamp = null;
    progressTotalDuration = 0;
    progressElapsedOffset = 0;

    if (resetBar) {
        updateProgressBar(0);
    }
}

function startProgressAnimation(totalDuration, elapsedOffset = 0) {
    stopProgressAnimation(false);

    progressTotalDuration = totalDuration;
    progressElapsedOffset = elapsedOffset;
    progressStartTimestamp = Date.now();

    function animate() {
        if (!isJourneyActive || isJourneyPausedByPopup || !progressStartTimestamp || !progressTotalDuration) {
            progressAnimationFrame = null;
            return;
        }

        const elapsed = progressElapsedOffset + (Date.now() - progressStartTimestamp);
        const progress = (elapsed / progressTotalDuration) * 100;
        updateProgressBar(progress);

        if (progress < 100) {
            progressAnimationFrame = requestAnimationFrame(animate);
        } else {
            updateProgressBar(0);
            progressAnimationFrame = null;
        }
    }

    animate();
}

function clearJourneyPopupAutoCloseTimer() {
    if (journeyPopupAutoCloseTimer) {
        clearTimeout(journeyPopupAutoCloseTimer);
        journeyPopupAutoCloseTimer = null;
    }
}

function scheduleJourneyPopupAutoClose(popup, autoCloseMs = JOURNEY_POPUP_AUTO_CLOSE_MS) {
    clearJourneyPopupAutoCloseTimer();

    journeyPopupAutoCloseTimer = setTimeout(() => {
        if (activeJourneyPopup === popup) {
            removePopupWithAnimation(popup);
        }
    }, autoCloseMs);
}

function pauseJourneyForPopup() {
    if (!isJourneyActive || isJourneyPausedByPopup) {
        return;
    }

    if (journeyTimeout) {
        clearTimeout(journeyTimeout);
        journeyTimeout = null;
    }

    const elapsed = journeyStepStartedAt ? Math.max(0, Date.now() - journeyStepStartedAt) : 0;
    journeyRemainingMs = Math.max(0, JOURNEY_STEP_DURATION_MS - elapsed);

    stopProgressAnimation(false);
    updateProgressBar((elapsed / JOURNEY_STEP_DURATION_MS) * 100);

    clearJourneyStagePopupTimer();
    isJourneyPausedByPopup = true;
    appMode = APP_MODES.JOURNEY_PAUSED_BY_POPUP;
}

function scheduleJourneyAdvance(delayMs) {
    if (journeyTimeout) {
        clearTimeout(journeyTimeout);
    }

    journeyTimeout = setTimeout(() => {
        currentJourneyIndex += 1;
        startJourney();
    }, delayMs);
}

function resumeJourneyFromPopup() {
    if (!isJourneyActive || !isJourneyPausedByPopup) {
        return;
    }

    isJourneyPausedByPopup = false;
    appMode = APP_MODES.JOURNEY_RUNNING;

    if (journeyRemainingMs <= 0) {
        currentJourneyIndex += 1;
        startJourney();
        return;
    }

    const elapsed = JOURNEY_STEP_DURATION_MS - journeyRemainingMs;
    journeyStepStartedAt = Date.now() - elapsed;
    startProgressAnimation(JOURNEY_STEP_DURATION_MS, elapsed);
    scheduleJourneyAdvance(journeyRemainingMs);
}

function closeActiveJourneyPopup(options = {}) {
    const { animated = true } = options;

    if (!activeJourneyPopup) {
        return;
    }

    if (animated) {
        removePopupWithAnimation(activeJourneyPopup);
    } else {
        activeJourneyPopup.remove();
    }
}

function closeProjectPopup(popup, options = {}) {
    const { animated = true } = options;
    if (!popup) {
        return;
    }

    popup.getElement()?.querySelectorAll('video').forEach((video) => video.pause());

    if (animated) {
        removePopupWithAnimation(popup);
    } else {
        popup.remove();
    }
}

function closeAllProjectPopups(options = {}) {
    const { animated = true } = options;
    activeProjectPopupById.clear();

    for (const popup of Array.from(activeProjectPopups)) {
        closeProjectPopup(popup, { animated });
    }
}

function buildJourneyPopupData(point) {
    return {
        title: point.name,
        description: point.description,
        hideDescription: true,
        image: resolveJourneyImage(point),
        linkUrl: resolveJourneyLink(point),
        linkLabel: resolveJourneyLinkLabel(point),
        date: point.date
    };
}

function createJourneyPopup(point, options = {}) {
    const {
        pauseOnOpen = false,
        autoCloseMs = JOURNEY_POPUP_AUTO_CLOSE_MS
    } = options;

    const popupData = buildJourneyPopupData(point);
    const content = createPopupCard(popupData);
    const popup = new maplibregl.Popup({
        offset: 20,
        maxWidth: '250px',
        closeButton: true,
        closeOnClick: false
    }).setDOMContent(content);

    journeyPopupMeta.set(popup, {
        pauseOnOpen,
        autoCloseMs
    });

    popup.on('open', () => {
        if (activeJourneyPopup && activeJourneyPopup !== popup) {
            isReplacingJourneyPopup = true;
            activeJourneyPopup.remove();
            isReplacingJourneyPopup = false;
        }

        activeJourneyPopup = popup;

        if (journeyPopupCleanupHandlers.has(popup)) {
            journeyPopupCleanupHandlers.get(popup)?.();
        }

        animatePopupCardOpen(content);

        const popupMeta = journeyPopupMeta.get(popup);
        let cleanup = () => {};

        if (popupMeta?.autoCloseMs) {
            cleanup = attachPopupInteractionHandlers(content, {
                onInteractionStart: () => clearJourneyPopupAutoCloseTimer(),
                onInteractionEnd: () => scheduleJourneyPopupAutoClose(popup, popupMeta.autoCloseMs)
            });

            scheduleJourneyPopupAutoClose(popup, popupMeta.autoCloseMs);
        }

        journeyPopupCleanupHandlers.set(popup, cleanup);

        if (popupMeta?.pauseOnOpen && isJourneyActive) {
            pauseJourneyForPopup();
        }
    });

    popup.on('close', () => {
        if (activeJourneyPopup === popup) {
            activeJourneyPopup = null;
        }

        clearJourneyPopupAutoCloseTimer();

        const cleanup = journeyPopupCleanupHandlers.get(popup);
        if (cleanup) {
            cleanup();
            journeyPopupCleanupHandlers.delete(popup);
        }

        const popupMeta = journeyPopupMeta.get(popup);
        journeyPopupMeta.delete(popup);

        if (!isReplacingJourneyPopup && popupMeta?.pauseOnOpen && isJourneyActive && isJourneyPausedByPopup) {
            resumeJourneyFromPopup();
        }
    });

    return popup;
}

function openJourneyPopupForPoint(point, options = {}) {
    const popup = createJourneyPopup(point, options)
        .setLngLat(point.coords);

    popup.addTo(map);
    return popup;
}

function openProjectPopup(project, options = {}) {
    const { lngLat = project.coords } = options;
    const existingPopup = activeProjectPopupById.get(project.id);
    if (existingPopup) {
        return existingPopup;
    }

    let popup = null;
    const content = createPopupCard(project, {
        variant: 'project',
        showCloseButton: true,
        onRequestClose: () => {
            if (popup) {
                closeProjectPopup(popup);
            }
        }
    });
    popup = new maplibregl.Popup({
        offset: 20,
        maxWidth: '250px',
        closeButton: false,
        closeOnClick: false
    })
        .setLngLat(lngLat)
        .setDOMContent(content);

    popup.on('open', () => {
        activeProjectPopups.add(popup);
        activeProjectPopupById.set(project.id, popup);

        const popupElement = popup.getElement?.();
        if (popupElement) {
            popupElement.style.zIndex = String(getProjectStackZIndex(project).popup);
        }

        animatePopupCardOpen(content);
    });

    popup.on('close', () => {
        activeProjectPopups.delete(popup);
        if (activeProjectPopupById.get(project.id) === popup) {
            activeProjectPopupById.delete(project.id);
        }
    });

    popup.addTo(map);
    return popup;
}

function toggleProjectPopup(project) {
    const existingPopup = activeProjectPopupById.get(project.id);
    if (existingPopup) {
        closeProjectPopup(existingPopup);
        return;
    }

    openProjectPopup(project);
}

function getProjectStackZIndex(project) {
    const index = projectsData.findIndex((item) => item.id === project.id);
    const safeIndex = index === -1 ? projectsData.length : index;
    const rank = projectsData.length - safeIndex;
    return {
        marker: 2000 + rank,
        popup: 3000 + rank
    };
}

function showProjectMarker(project) {
    addProjectMarkers();

    const markerEntry = projectMarkers.find((entry) => entry.id === project.id);
    if (!markerEntry || visibleProjectMarkerIds.has(project.id)) {
        return;
    }

    markerEntry.element.style.transform = 'scale(0)';
    markerEntry.marker.addTo(map);
    visibleProjectMarkerIds.add(project.id);

    requestAnimationFrame(() => {
        markerEntry.element.style.transform = 'scale(1)';
    });
}

function addProjectMarkers() {
    if (projectMarkers.length > 0) {
        return;
    }

    projectsData.forEach((project) => {
        const markerElement = createMarkerElement(project.markerLabel);
        markerElement.classList.add('project-marker');
        const stack = getProjectStackZIndex(project);
        markerElement.style.zIndex = String(stack.marker);

        const marker = new maplibregl.Marker({ element: markerElement })
            .setLngLat(project.coords);

        marker.getElement().addEventListener('click', () => {
            appMode = APP_MODES.PROJECTS_MODE;
            gtag('event', 'project_popup_open', { project_id: project.id, project_title: project.title });
            toggleProjectPopup(project);
        });

        projectMarkers.push({
            id: project.id,
            marker,
            element: markerElement
        });
    });
}

function preloadProjectPopupImages() {
    projectsData.forEach((project) => {
        const img = new Image();
        img.src = normalizeAssetPath(project.image);
    });
}

function hideProjectMarkerWithAnimation(projectId, options = {}) {
    const {
        duration = PROJECT_MARKER_EXIT_DURATION_MS,
        token = null
    } = options;

    const markerEntry = projectMarkers.find((entry) => entry.id === projectId);
    if (!markerEntry || !visibleProjectMarkerIds.has(projectId)) {
        return;
    }

    markerEntry.element.style.transform = 'scale(0)';
    const removalTimer = setTimeout(() => {
        if (token !== null && token !== projectExitSequenceToken) {
            return;
        }

        markerEntry.marker.remove();
        visibleProjectMarkerIds.delete(projectId);
    }, duration);

    projectExitSequenceTimers.push(removalTimer);
}

function runProjectExitSequence() {
    clearProjectExitSequenceTimers();
    const token = projectExitSequenceToken;
    const reverseProjects = [...projectsData].reverse();

    reverseProjects.forEach((project, index) => {
        const timer = setTimeout(() => {
            if (token !== projectExitSequenceToken || appMode === APP_MODES.PROJECTS_MODE) {
                return;
            }

            const popup = activeProjectPopupById.get(project.id);
            if (popup) {
                closeProjectPopup(popup);
            }

            hideProjectMarkerWithAnimation(project.id, { token });
        }, index * PROJECT_EXIT_STAGGER_MS);

        projectExitSequenceTimers.push(timer);
    });
}

function hideProjectMarkers() {
    clearProjectExitSequenceTimers();

    if (visibleProjectMarkerIds.size === 0) {
        return;
    }

    projectMarkers.forEach((entry) => entry.marker.remove());
    visibleProjectMarkerIds.clear();
}

function runProjectRevealSequence() {
    clearProjectExitSequenceTimers();
    closeAllProjectPopups({ animated: false });
    hideProjectMarkers();
    stopProjectFlight();
    if (map.isMoving()) {
        map.stop();
    }

    const firstProject = projectsData[0];
    if (!firstProject) {
        return;
    }

    const secondProject = projectsData[1] || firstProject;
    const entryBearing = calculateBearing(firstProject.coords, secondProject.coords);

    showProjectMarker(firstProject);
    openProjectPopup(firstProject);

    const flightPathPoints = getProjectFlightPathPoints();
    if (flightPathPoints.length <= 1) {
        map.flyTo({
            center: firstProject.coords,
            zoom: PROJECT_FLIGHT_ZOOM,
            pitch: PROJECT_FLIGHT_PITCH,
            bearing: entryBearing,
            duration: PROJECT_ENTRY_DURATION_MS,
            essential: true
        });
        return;
    }

    const startContinuousProjectFlight = (entryBlendStartState = null) => {
        if (appMode !== APP_MODES.PROJECTS_MODE) {
            return;
        }

        const overviewTarget = getProjectOverviewTarget();
        const revealProgressByProject = new Map(
            projectsData.map((project, index) => [project.id, index / (flightPathPoints.length - 1)])
        );
        const revealedProjectIds = new Set([firstProject.id]);
        const totalDuration = PROJECT_FLIGHT_BASE_DURATION_MS + ((flightPathPoints.length - 1) * PROJECT_FLIGHT_PER_PROJECT_MS);
        const blendStartMs = totalDuration * PROJECT_OVERVIEW_BLEND_START_PROGRESS;
        let animationStartTime = null;
        let smoothedBearing = entryBearing;
        let overviewBlendStarted = false;
        let overviewBlendStartBearing = entryBearing;

        const step = (timestamp) => {
            if (appMode !== APP_MODES.PROJECTS_MODE) {
                stopProjectFlight();
                return;
            }

            if (!animationStartTime) {
                animationStartTime = timestamp;
            }

            const elapsedMs = timestamp - animationStartTime;
            const pathLinearProgress = Math.min(elapsedMs / totalDuration, 1);
            const pathEasedProgress = easeInOutCubic(pathLinearProgress);
            const pathCenter = interpolatePath(flightPathPoints, pathEasedProgress);
            const blendLinear = overviewTarget
                ? Math.max(0, Math.min(1, (elapsedMs - blendStartMs) / Math.max(1, PROJECT_OVERVIEW_DURATION_MS)))
                : 0;
            const overviewBlendProgress = easeInOutCubic(blendLinear);
            const isInOverviewBlend = Boolean(overviewTarget) && overviewBlendProgress > 0;

            if (!isInOverviewBlend) {
                const lookAheadCenter = interpolatePath(flightPathPoints, Math.min(1, pathEasedProgress + PROJECT_PATH_LOOKAHEAD));
                const targetBearing = calculateBearing(pathCenter, lookAheadCenter);
                smoothedBearing = interpolateBearing(smoothedBearing, targetBearing, PROJECT_BEARING_SMOOTHING);
            } else if (!overviewBlendStarted) {
                overviewBlendStarted = true;
                overviewBlendStartBearing = smoothedBearing;
            }

            const center = isInOverviewBlend
                ? [
                    lerp(pathCenter[0], overviewTarget.center[0], overviewBlendProgress),
                    lerp(pathCenter[1], overviewTarget.center[1], overviewBlendProgress)
                ]
                : pathCenter;
            const zoom = isInOverviewBlend
                ? lerp(PROJECT_FLIGHT_ZOOM, overviewTarget.zoom, overviewBlendProgress)
                : PROJECT_FLIGHT_ZOOM;
            const pitch = isInOverviewBlend
                ? lerp(PROJECT_FLIGHT_PITCH, overviewTarget.pitch, overviewBlendProgress)
                : PROJECT_FLIGHT_PITCH;
            const bearing = isInOverviewBlend
                ? interpolateBearingByProgress(overviewBlendStartBearing, overviewTarget.bearing, overviewBlendProgress)
                : smoothedBearing;
            const entryBlendProgress = entryBlendStartState
                ? easeOutCubic(Math.max(0, Math.min(1, elapsedMs / PROJECT_ENTRY_TO_PATH_BLEND_MS)))
                : 1;
            const finalCenter = entryBlendStartState
                ? [
                    lerp(entryBlendStartState.center[0], center[0], entryBlendProgress),
                    lerp(entryBlendStartState.center[1], center[1], entryBlendProgress)
                ]
                : center;
            const finalZoom = entryBlendStartState
                ? lerp(entryBlendStartState.zoom, zoom, entryBlendProgress)
                : zoom;
            const finalPitch = entryBlendStartState
                ? lerp(entryBlendStartState.pitch, pitch, entryBlendProgress)
                : pitch;
            const finalBearing = entryBlendStartState
                ? interpolateBearingByProgress(entryBlendStartState.bearing, bearing, entryBlendProgress)
                : bearing;

            map.jumpTo({
                center: finalCenter,
                zoom: finalZoom,
                pitch: finalPitch,
                bearing: finalBearing,
                animate: false
            });

            projectsData.forEach((project) => {
                const revealProgress = revealProgressByProject.get(project.id) ?? 1;
                if (!revealedProjectIds.has(project.id) && pathEasedProgress >= revealProgress) {
                    revealedProjectIds.add(project.id);
                    showProjectMarker(project);
                    openProjectPopup(project);
                }
            });

            const isPathComplete = pathLinearProgress >= 1;
            const isOverviewBlendComplete = !overviewTarget || blendLinear >= 1;

            if (!isPathComplete || !isOverviewBlendComplete) {
                projectFlightAnimationFrame = requestAnimationFrame(step);
                return;
            }

            projectsData.forEach((project) => {
                showProjectMarker(project);
                openProjectPopup(project);
            });

            if (!overviewTarget) {
                const isMobile = window.innerWidth <= 640;
                const overviewBearing = isMobile ? PROJECT_OVERVIEW_BEARING_MOBILE : PROJECT_OVERVIEW_BEARING;
                map.fitBounds(getProjectBounds(), {
                    padding: {
                        top: 80,
                        bottom: 120,
                        left: 80,
                        right: 80
                    },
                    duration: PROJECT_OVERVIEW_DURATION_MS,
                    maxZoom: Math.max(0, PROJECT_FLIGHT_ZOOM - PROJECT_OVERVIEW_ZOOM_OUT_DELTA),
                    bearing: overviewBearing,
                    pitch: PROJECT_OVERVIEW_PITCH,
                    essential: true
                });
                stopProjectFlight();
                return;
            }

            map.jumpTo({
                center: overviewTarget.center,
                zoom: overviewTarget.zoom,
                pitch: overviewTarget.pitch,
                bearing: overviewTarget.bearing,
                animate: false
            });
            stopProjectFlight();
        };

        projectFlightAnimationFrame = requestAnimationFrame(step);
    };

    map.flyTo({
        center: firstProject.coords,
        zoom: PROJECT_FLIGHT_ZOOM,
        pitch: PROJECT_FLIGHT_PITCH,
        bearing: entryBearing,
        duration: PROJECT_ENTRY_DURATION_MS,
        essential: true
    });

    const entryHandoffDelayMs = Math.max(0, PROJECT_ENTRY_DURATION_MS - PROJECT_ENTRY_HANDOFF_EARLY_MS);
    clearProjectEntryHandoffTimer();
    projectEntryHandoffTimer = setTimeout(() => {
        projectEntryHandoffTimer = null;

        if (appMode !== APP_MODES.PROJECTS_MODE) {
            return;
        }

        const center = map.getCenter();
        const entryBlendStartState = {
            center: [center.lng, center.lat],
            zoom: map.getZoom(),
            pitch: map.getPitch(),
            bearing: map.getBearing()
        };

        map.stop();
        startContinuousProjectFlight(entryBlendStartState);
    }, entryHandoffDelayMs);
}

function addMarkers() {
    const numbers = ['1', '2', '3', '4', '5', '6', '7'];

    journey.forEach((point, index) => {
        let markerContent = numbers[index] || '*';

        if (index === 7) {
            markerContent = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="5.5" cy="17.5" r="3.5"/>
                    <circle cx="18.5" cy="17.5" r="3.5"/>
                    <path d="M15 6a1 1 0 1 0 0-4 1 1 0 0 0 0 4z"/>
                    <path d="M12 17.5V14l-3-3 4-3 2 3h3"/>
                </svg>
            `;
        } else if (index === 8) {
            markerContent = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 12h20M2 12v6M22 12v6M5 12v6M19 12v6M5 6h14M5 6v6M19 6v6M9 6v6M15 6v6"/>
                </svg>
            `;
        }

        const marker = new maplibregl.Marker({ element: createMarkerElement(markerContent) })
            .setLngLat(point.coords);

        marker.getElement().addEventListener('click', () => {
            if (appMode === APP_MODES.PROJECTS_MODE) {
                exitProjectsMode({ flyToIntro: false, animateProjectItemsExit: false });
            }

            openJourneyPopupForPoint(point, {
                pauseOnOpen: isJourneyActive,
                autoCloseMs: JOURNEY_POPUP_AUTO_CLOSE_MS
            });
        });

        journeyMarkers.push(marker);
    });
}

function showJourneyMarkers() {
    journeyMarkers.forEach((marker) => marker.addTo(map));
}

function hideJourneyMarkers() {
    journeyMarkers.forEach((marker) => marker.remove());
}

function setupRotationToggle() {
    const toggleButton = document.getElementById('rotation-toggle');
    if (!toggleButton) {
        return;
    }

    toggleButton.addEventListener('click', () => {
        isRotating = !isRotating;
        toggleButton.textContent = isRotating ? 'STOP' : 'START';
        isInteracting = false;

        if (isRotating) {
            rotateGlobe();
        }
    });
}

function createKeycapSVG(key, options = {}) {
    const {
        width = 18,
        height = 18,
        fontSize = 10
    } = options;
    const textX = width / 2;
    const textY = height / 2;

    return `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="keycap-svg" style="width:${width}px;height:${height}px;">
            <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="2" fill="#3a3a3a" stroke="#089BDF" stroke-width="1"/>
            <text x="${textX}" y="${textY}" font-family="'Quantico', sans-serif" font-size="${fontSize}" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="central" alignment-baseline="central">${key}</text>
        </svg>
    `;
}

function updateJourneyButtonText() {
    const journeyButton = document.getElementById('journey-toggle');
    if (!journeyButton) {
        return;
    }

    const isMobile = window.innerWidth <= 640;
    if (appMode === APP_MODES.PROJECTS_MODE) {
        const escKeycapSVG = isMobile ? '' : createKeycapSVG('ESC', { width: 30, height: 18, fontSize: 7 });
        journeyButton.innerHTML = isMobile
            ? 'PRESS TO EXIT PROJECT MODE'
            : `PRESS ${escKeycapSVG} TO EXIT PROJECT MODE`;
        return;
    }

    const keycapSVG = isMobile ? '' : createKeycapSVG('P');
    const actionText = isJourneyActive ? 'STOP JOURNEY' : 'START JOURNEY';
    journeyButton.innerHTML = isMobile
        ? `PRESS TO ${actionText}`
        : `PRESS ${keycapSVG} TO ${actionText}`;
}

function toggleJourney() {
    if (appMode === APP_MODES.PROJECTS_MODE) {
        exitProjectsMode();
        return;
    }

    if (isJourneyActive) {
        gtag('event', 'journey_stopped');
        stopJourney();
        checkAndStartTextRotation();
    } else {
        gtag('event', 'journey_started');
        closeAllProjectPopups();
        hideProjectMarkers();
        stopProjectFlight();
        stopProjectModeTextRotation();
        stopTextRotation();
        currentJourneyIndex = 0;
        isJourneyActive = true;
        isJourneyPausedByPopup = false;
        appMode = APP_MODES.JOURNEY_RUNNING;
        showJourneyMarkers();
        startJourney();
    }

    updateJourneyButtonText();
}

function setupJourneyToggle() {
    const journeyButton = document.getElementById('journey-toggle');
    if (!journeyButton) {
        return;
    }

    updateJourneyButtonText();
    journeyButton.addEventListener('click', toggleJourney);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isProjectDetailModalOpen()) {
            e.preventDefault();
            closeProjectDetailModal();
            return;
        }

        if (e.key === 'Escape' && appMode === APP_MODES.PROJECTS_MODE) {
            e.preventDefault();
            exitProjectsMode();
            return;
        }

        if (e.key === 'Escape' && isJourneyActive) {
            e.preventDefault();
            gtag('event', 'journey_stopped');
            stopJourney();
            checkAndStartTextRotation();
            updateJourneyButtonText();
            return;
        }

        if (e.key === 'p' || e.key === 'P') {
            e.preventDefault();
            toggleJourney();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        updateJourneyButtonText();
    });
} else {
    updateJourneyButtonText();
}

function updateJourneyText(description) {
    const taglineElement = document.querySelector('.text-group-top-left .tagline');
    if (!taglineElement) {
        return;
    }

    taglineElement.style.opacity = '';
    taglineElement.style.transform = '';
    taglineElement.style.filter = '';
    typewriterRandom(taglineElement, description, 10, () => decorateSparks(taglineElement));
}

// The ✽ in a tagline becomes Claude Code's spinner: · ✢ ✳ ✶ ✻ ✽ and back.
// U+FE0E keeps ✳ a text glyph instead of an emoji on iOS.
const SPARK_FRAMES = ['·', '✢', '✳', '✶', '✻', '✽'].map((g) => g + '\uFE0E');
const SPARK_SEQUENCE = [...SPARK_FRAMES, ...SPARK_FRAMES.slice(1, -1).reverse()];
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let sparkTick = 0;

function decorateSparks(element) {
    const text = element.textContent;
    if (!text.includes('✽')) {
        return;
    }
    const escape = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let phase = 0;
    element.innerHTML = text.split('✽').map(escape).join('\u0000').replace(/\u0000/g, () => {
        const span = `<span class="spark" data-phase="${phase}">✽\uFE0E</span>`;
        phase += Math.floor(SPARK_SEQUENCE.length / 2);
        return span;
    });
}

if (!prefersReducedMotion) {
    setInterval(() => {
        sparkTick++;
        document.querySelectorAll('.spark').forEach((el) => {
            const phase = Number(el.dataset.phase) || 0;
            el.textContent = SPARK_SEQUENCE[(sparkTick + phase) % SPARK_SEQUENCE.length];
        });
    }, 120);

    const grainNoise = document.getElementById('film-grain-noise');
    if (grainNoise) {
        setInterval(() => grainNoise.setAttribute('seed', String(Math.floor(Math.random() * 1000))), 83);
    }
}

function updateJourneyDate(date) {
    const datePillElement = document.querySelector('.text-group-top-left .date-pill');
    if (!datePillElement) {
        return;
    }

    if (date) {
        datePillElement.textContent = date;
        datePillElement.style.display = 'inline-block';
    } else {
        datePillElement.textContent = '';
        datePillElement.style.display = 'none';
    }
}

let routeLoaded = false;
const PONDICHERRY_ROUTE_SOURCE_ID = 'pondicherry-route';
const PONDICHERRY_ROUTE_OUTLINE_LAYER_ID = 'pondicherry-route-outline';
const PONDICHERRY_ROUTE_LINE_LAYER_ID = 'pondicherry-route-line';
const PONDICHERRY_ROUTE_LINE_COLOR = '#089BDF';
const PONDICHERRY_ROUTE_OUTLINE_COLOR = '#ffffff';
const PONDICHERRY_ROUTE_POINT_ANIMATION_DURATION_MS = Math.max(120, JOURNEY_FLY_DURATION_MS / 1.5);

let pondicherryRouteRevealAnimationFrame = null;
let pondicherryRouteRevealStartTime = null;
let pondicherryRouteRevealOnComplete = null;
let pondicherryRouteCoordinates = [];
let pondicherryRouteAnimatedData = null;
let pondicherryRouteLastPointCount = 0;

function initializePondicherryRouteAnimationData(data) {
    const routeFeature = data?.features?.find?.((feature) => feature?.geometry?.type === 'LineString');
    const coordinates = routeFeature?.geometry?.coordinates;

    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return false;
    }

    pondicherryRouteCoordinates = coordinates.map((coordinate) => [coordinate[0], coordinate[1]]);
    pondicherryRouteAnimatedData = {
        type: 'FeatureCollection',
        features: [
            {
                type: 'Feature',
                properties: routeFeature.properties || {},
                geometry: {
                    type: 'LineString',
                    coordinates: pondicherryRouteCoordinates.slice(0, 2)
                }
            }
        ]
    };
    pondicherryRouteLastPointCount = 2;
    return true;
}

function setPondicherryRoutePointCount(pointCount) {
    if (!pondicherryRouteAnimatedData || pondicherryRouteCoordinates.length < 2) {
        return;
    }

    const source = map.getSource(PONDICHERRY_ROUTE_SOURCE_ID);
    if (!source) {
        return;
    }

    const clampedPointCount = Math.min(
        pondicherryRouteCoordinates.length,
        Math.max(2, Math.floor(pointCount))
    );

    if (clampedPointCount === pondicherryRouteLastPointCount) {
        return;
    }

    pondicherryRouteAnimatedData.features[0].geometry.coordinates = pondicherryRouteCoordinates.slice(0, clampedPointCount);
    source.setData(pondicherryRouteAnimatedData);
    pondicherryRouteLastPointCount = clampedPointCount;
}

function stopPondicherryRouteRevealAnimation() {
    if (pondicherryRouteRevealAnimationFrame) {
        cancelAnimationFrame(pondicherryRouteRevealAnimationFrame);
        pondicherryRouteRevealAnimationFrame = null;
    }

    pondicherryRouteRevealStartTime = null;
    pondicherryRouteRevealOnComplete = null;
}

function animatePondicherryRoutePointCount(fromPointCount, toPointCount, options = {}) {
    const { onComplete = null } = options;

    stopPondicherryRouteRevealAnimation();

    if (!pondicherryRouteAnimatedData || pondicherryRouteCoordinates.length < 2) {
        onComplete?.();
        return;
    }

    const maxPointCount = pondicherryRouteCoordinates.length;
    const startCount = Math.min(maxPointCount, Math.max(2, Math.floor(fromPointCount)));
    const endCount = Math.min(maxPointCount, Math.max(2, Math.floor(toPointCount)));

    if (startCount === endCount || PONDICHERRY_ROUTE_POINT_ANIMATION_DURATION_MS <= 0) {
        setPondicherryRoutePointCount(endCount);
        onComplete?.();
        return;
    }

    setPondicherryRoutePointCount(startCount);
    pondicherryRouteRevealStartTime = performance.now();
    pondicherryRouteRevealOnComplete = onComplete;

    const animatePoints = (timestamp) => {
        if (!pondicherryRouteRevealStartTime) {
            pondicherryRouteRevealAnimationFrame = null;
            return;
        }

        const elapsed = timestamp - pondicherryRouteRevealStartTime;
        const progress = Math.min(1, elapsed / PONDICHERRY_ROUTE_POINT_ANIMATION_DURATION_MS);
        const easedProgress = easeInOutCubic(progress);
        const pointCount = Math.round(lerp(startCount, endCount, easedProgress));
        setPondicherryRoutePointCount(pointCount);

        if (progress < 1) {
            pondicherryRouteRevealAnimationFrame = requestAnimationFrame(animatePoints);
            return;
        }

        setPondicherryRoutePointCount(endCount);
        pondicherryRouteRevealAnimationFrame = null;
        pondicherryRouteRevealStartTime = null;
        const completionHandler = pondicherryRouteRevealOnComplete;
        pondicherryRouteRevealOnComplete = null;
        completionHandler?.();
    };

    pondicherryRouteRevealAnimationFrame = requestAnimationFrame(animatePoints);
}

function startPondicherryRouteRevealAnimation() {
    if (!map.getLayer(PONDICHERRY_ROUTE_OUTLINE_LAYER_ID) && !map.getLayer(PONDICHERRY_ROUTE_LINE_LAYER_ID)) {
        return;
    }

    if (!pondicherryRouteAnimatedData || pondicherryRouteCoordinates.length < 2) {
        return;
    }

    setPondicherryRouteVisibility('visible');
    animatePondicherryRoutePointCount(2, pondicherryRouteCoordinates.length);
}

function setPondicherryRouteVisibility(visibility) {
    if (map.getLayer(PONDICHERRY_ROUTE_OUTLINE_LAYER_ID)) {
        map.setLayoutProperty(PONDICHERRY_ROUTE_OUTLINE_LAYER_ID, 'visibility', visibility);
    }

    if (map.getLayer(PONDICHERRY_ROUTE_LINE_LAYER_ID)) {
        map.setLayoutProperty(PONDICHERRY_ROUTE_LINE_LAYER_ID, 'visibility', visibility);
    }
}

function loadPondicherryRoute() {
    if (routeLoaded) {
        setPondicherryRouteVisibility('visible');
        startPondicherryRouteRevealAnimation();
        return;
    }

    if (!map.loaded()) {
        map.once('load', () => loadPondicherryRoute());
        return;
    }

    fetch('/bangalore-pondicherry-route.geojson')
        .then((response) => response.json())
        .then((data) => {
            if (!initializePondicherryRouteAnimationData(data)) {
                return;
            }

            if (!map.getSource(PONDICHERRY_ROUTE_SOURCE_ID)) {
                map.addSource(PONDICHERRY_ROUTE_SOURCE_ID, {
                    type: 'geojson',
                    data: pondicherryRouteAnimatedData
                });

                map.addLayer({
                    id: PONDICHERRY_ROUTE_OUTLINE_LAYER_ID,
                    type: 'line',
                    source: PONDICHERRY_ROUTE_SOURCE_ID,
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round',
                        visibility: 'visible'
                    },
                    paint: {
                        'line-color': PONDICHERRY_ROUTE_OUTLINE_COLOR,
                        'line-width': 9,
                        'line-opacity': 0.95
                    }
                });

                map.addLayer({
                    id: PONDICHERRY_ROUTE_LINE_LAYER_ID,
                    type: 'line',
                    source: PONDICHERRY_ROUTE_SOURCE_ID,
                    layout: {
                        'line-join': 'round',
                        'line-cap': 'round',
                        visibility: 'visible'
                    },
                    paint: {
                        'line-color': PONDICHERRY_ROUTE_LINE_COLOR,
                        'line-width': 5,
                        'line-opacity': 1
                    }
                });

                routeLoaded = true;
                startPondicherryRouteRevealAnimation();
            } else {
                setPondicherryRouteVisibility('visible');
                startPondicherryRouteRevealAnimation();
            }
        })
        .catch(() => {});
}

function hidePondicherryRoute() {
    if (!map.getLayer(PONDICHERRY_ROUTE_OUTLINE_LAYER_ID) && !map.getLayer(PONDICHERRY_ROUTE_LINE_LAYER_ID)) {
        return;
    }

    if (!pondicherryRouteAnimatedData || pondicherryRouteCoordinates.length < 2) {
        setPondicherryRouteVisibility('none');
        return;
    }

    const currentPointCount = Math.max(2, pondicherryRouteLastPointCount || pondicherryRouteCoordinates.length);
    if (currentPointCount <= 2) {
        setPondicherryRoutePointCount(2);
        setPondicherryRouteVisibility('none');
        return;
    }

    animatePondicherryRoutePointCount(currentPointCount, 2, {
        onComplete: () => {
            setPondicherryRouteVisibility('none');
        }
    });
}

function scheduleAutoJourneyStagePopup(point, journeyIndexAtSchedule) {
    clearJourneyStagePopupTimer();

    journeyStagePopupTimer = setTimeout(() => {
        if (!isJourneyActive || isJourneyPausedByPopup) {
            return;
        }

        if (currentJourneyIndex !== journeyIndexAtSchedule) {
            return;
        }

        openJourneyPopupForPoint(point, {
            pauseOnOpen: false,
            autoCloseMs: null
        });
    }, JOURNEY_FLY_DURATION_MS / 2);
}

function startJourney() {
    if (!isJourneyActive || currentJourneyIndex >= journey.length) {
        isJourneyActive = false;
        isJourneyPausedByPopup = false;
        appMode = APP_MODES.IDLE;
        stopProgressAnimation(true);
        clearJourneyStagePopupTimer();
        closeActiveJourneyPopup();
        hideJourneyMarkers();
        updateJourneyButtonText();

        currentTextIndex = 0;
        updateJourneyText(dynamicTexts[0]);
        updateJourneyDate('');

        if (currentJourneyIndex >= journey.length) {
            gtag('event', 'journey_completed');
            map.flyTo({
                center: textCoords,
                zoom: 10,
                bearing: 10,
                pitch: 30,
                duration: 2000
            });
        }

        checkAndStartTextRotation();
        return;
    }

    const location = journey[currentJourneyIndex];
    updateJourneyText(location.journeyText || location.description);
    updateJourneyDate(location.date);

    if (currentJourneyIndex === 7 && location.name === 'Pondicherry') {
        loadPondicherryRoute();
    } else {
        hidePondicherryRoute();
    }

    clearJourneyStagePopupTimer();
    closeActiveJourneyPopup();

    isJourneyPausedByPopup = false;
    appMode = APP_MODES.JOURNEY_RUNNING;
    journeyStepStartedAt = Date.now();
    journeyRemainingMs = JOURNEY_STEP_DURATION_MS;

    startProgressAnimation(JOURNEY_STEP_DURATION_MS, 0);

    const stageIndex = currentJourneyIndex;
    map.flyTo({
        center: location.coords,
        zoom: location.zoom,
        bearing: location.bearing,
        pitch: location.pitch,
        duration: JOURNEY_FLY_DURATION_MS,
        essential: true
    });

    scheduleJourneyAdvance(JOURNEY_STEP_DURATION_MS);
    scheduleAutoJourneyStagePopup(location, stageIndex);
}

function stopJourney(options = {}) {
    const { flyToIntro = true } = options;

    isJourneyActive = false;
    isJourneyPausedByPopup = false;

    if (journeyTimeout) {
        clearTimeout(journeyTimeout);
        journeyTimeout = null;
    }

    stopProgressAnimation(true);
    clearJourneyStagePopupTimer();
    clearJourneyPopupAutoCloseTimer();
    closeActiveJourneyPopup();
    hideJourneyMarkers();

    currentJourneyIndex = 0;
    journeyStepStartedAt = null;
    journeyRemainingMs = JOURNEY_STEP_DURATION_MS;

    currentTextIndex = 0;
    updateJourneyText(dynamicTexts[0]);
    updateJourneyDate('');
    hidePondicherryRoute();

    appMode = APP_MODES.IDLE;

    if (flyToIntro) {
        map.flyTo({
            center: textCoords,
            zoom: 10,
            bearing: 10,
            pitch: 30,
            duration: 3000
        });
    }
}

function startTextRotation() {
    if (textRotationInterval) {
        return;
    }

    function rotateText() {
        if (isJourneyActive) {
            stopTextRotation();
            return;
        }

        currentTextIndex = (currentTextIndex + 1) % dynamicTexts.length;
        updateJourneyText(dynamicTexts[currentTextIndex]);
    }

    textRotationInterval = setInterval(rotateText, ROTATION_INTERVAL);
}

function startProjectModeTextRotation() {
    stopProjectModeTextRotation();

    updateJourneyText(PROJECT_MODE_TEXT);
    updateJourneyDate('Project Mode');
}

function stopProjectModeTextRotation() {
    if (projectTextRotationInterval) {
        clearInterval(projectTextRotationInterval);
        projectTextRotationInterval = null;
    }
}

function stopTextRotation() {
    if (textRotationInterval) {
        clearInterval(textRotationInterval);
        textRotationInterval = null;
    }

    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
}

function handleUserInteraction() {
    if (appMode === APP_MODES.PROJECTS_MODE) {
        return;
    }

    stopTextRotation();

    if (currentTextIndex !== 0) {
        currentTextIndex = 0;
        updateJourneyText(dynamicTexts[0]);
    }

    checkAndStartTextRotation();
}

function checkAndStartTextRotation() {
    if (isJourneyActive || appMode === APP_MODES.PROJECTS_MODE) {
        return;
    }

    if (idleTimer) {
        clearTimeout(idleTimer);
    }

    idleTimer = setTimeout(() => {
        if (!isJourneyActive) {
            startTextRotation();
        }
    }, IDLE_DELAY);
}

function exitProjectsMode(options = {}) {
    const {
        flyToIntro = true,
        animateProjectItemsExit = true
    } = options;

    if (appMode !== APP_MODES.PROJECTS_MODE) {
        return;
    }

    closeProjectDetailModal();
    stopProjectFlight();
    if (animateProjectItemsExit) {
        runProjectExitSequence();
    } else {
        closeAllProjectPopups();
        hideProjectMarkers();
    }
    stopProjectModeTextRotation();

    appMode = APP_MODES.IDLE;
    updateJourneyButtonText();
    updateJourneyDate('');
    currentTextIndex = 0;
    updateJourneyText(dynamicTexts[0]);
    checkAndStartTextRotation();

    if (flyToIntro) {
        map.flyTo({
            center: textCoords,
            zoom: 9.5,
            bearing: 10,
            pitch: 30,
            duration: 1800
        });
    }
}

function enterProjectsMode() {
    if (isJourneyActive) {
        stopJourney({ flyToIntro: false });
    }

    stopTextRotation();
    closeActiveJourneyPopup({ animated: false });
    closeProjectDetailModal();
    appMode = APP_MODES.PROJECTS_MODE;
    updateJourneyButtonText();
    startProjectModeTextRotation();
    runProjectRevealSequence();
}
// Levels only set the silhouette (never shown as numbers): strong on design,
// maps and 3D, honest about code (agents write it), alternating so the shape is spiky.
const skills = [
    { name: 'DESIGN', level: 95 },
    { name: 'FILM', level: 85 },
    { name: 'MAPS', level: 90 },
    { name: 'CODE', level: 55 },
    { name: '3D/GPU', level: 85 },
    { name: 'AI', level: 80 }
];

const chartCoords = [75.4, 12.88];
const chartFlyToCoords = [75.4, 12.98];
const textCoords = [74.75, 12.48]; 
const buttonCoords = [74.75, 12.45];

const customLayer = {
    id: 'threejs-radar-chart',
    type: 'custom',
    renderingMode: '3d',
    
    onAdd(map, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.scene.background = null;
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        this.scene.add(directionalLight);
        
        const skillLevels = skills.map(skill => skill.level / 100);
        const skillLabels = skills.map(skill => skill.name);
        this.radarChart = createRadarChart(skillLevels, 5, 6, skillLabels);
        
        this.animationStartTime = Date.now();
        this.animationDelay = 2000;
        this.animationDuration = 500;
        this.radarChart.scale.set(0, 0, 0);
        
        this.scene.add(this.radarChart);
        
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true
        });
        this.renderer.autoClear = false;
        this.map = map;
    },
    
    render(gl, args) {
        if (this.radarChart?.userData?.fillMesh) {
            this.radarChart.userData.fillMesh.material.uniforms.uTime.value = performance.now() / 1000;
        }

        if (this.radarChart && this.animationStartTime) {
            const elapsed = Date.now() - this.animationStartTime;
            
            if (elapsed < this.animationDelay) {
                this.radarChart.scale.set(0, 0, 0);
                this.map.triggerRepaint();
            } else {
                const animationElapsed = elapsed - this.animationDelay;
                const progress = Math.min(animationElapsed / this.animationDuration, 1);
                const easeOutCubic = 1 - Math.pow(1 - progress, 3);
                const overshoot = Math.sin(progress * Math.PI * 2.5) * 0.05 * (1 - progress);
                const subtleBounce = Math.min(1, easeOutCubic + overshoot);
                
                this.radarChart.scale.set(subtleBounce, subtleBounce, subtleBounce);
                const baseSpeed = 0.002;
                let burstSpeed = 0;
                if (this.spinBurstStartTime) {
                    const burstElapsed = (Date.now() - this.spinBurstStartTime) / 1000;
                    const burstDuration = 2.2;
                    if (burstElapsed < burstDuration) {
                        const t = burstElapsed / burstDuration;
                        const easeIn = 1 - Math.exp(-8 * t);
                        const decay = Math.exp(-4 * t);
                        burstSpeed = 0.16 * easeIn * decay;
                    } else {
                        this.spinBurstStartTime = null;
                    }
                }
                this.radarChart.rotation.y += baseSpeed + burstSpeed;
                this.map.triggerRepaint();
            }
        }
        
        const modelOrigin = chartCoords;
        const modelAltitude = 14000;
        const scaling = 2000;
        
        const modelMatrix = map.transform.getMatrixForModel(modelOrigin, modelAltitude);
        const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
        const l = new THREE.Matrix4()
            .fromArray(modelMatrix)
            .scale(new THREE.Vector3(scaling, scaling, scaling));
        
        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
    }
};

const text3DLayer = {
    id: 'threejs-3d-text',
    type: 'custom',
    renderingMode: '3d',
    
    onAdd(map, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.scene.background = null;
        this.textScaleIntroStartZ = 15;
        this.textScaleIntroEndZ = 0.004;
        this.textScaleIntroDurationMs = 2400;
        this.textScaleIntroDelayMs = 100;
        this.textScaleIntroQueuedAt = null;
        this.textScaleIntroStartTime = null;
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 2);
        this.scene.add(ambientLight);
        
        // RectAreaLight - rectangular area light (like a window/panel)
        const rectAreaLight = new THREE.RectAreaLight(0xffffff, 10, 10, 100);
        rectAreaLight.position.set(0, 0, 0);
        rectAreaLight.lookAt(0, 0, 0); // Point towards the text
        this.scene.add(rectAreaLight);
        this.rectAreaLight = rectAreaLight; // Store reference for animation
        
        // Animation start time
        this.lightAnimationStartTime = Date.now();
        
        // Load font and create text
        const fontLoader = new FontLoader();
        fontLoader.load('/fonts/InterTight_ExtraBold.json', (font) => {
            // Front face material (white)
            const frontMaterial = new THREE.MeshStandardMaterial({ 
                color: 0xDDE7EC, // Icy white, same as the film-subtitle tagline
                metalness: 0.0,
                roughness: 0.9
            });
            
            // Side/back material (dark grey)
            const sideMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x333333, // Dark grey
                metalness: 0.0,
                roughness: 0.9
            });
            
            // Text lines
            const lines = ['HEY! I\'M ARSHAD', 'NICE TO MEET YOU'];
            const fontSize = 0.5;
            const lineHeight = 1.45; // Control line spacing (multiplier of fontSize)
            
            // Create text group
            this.textGroup = new THREE.Group();
            
            // Inter Tight, set letter by letter so it can be tracked tight like the tagline
            // (TextGeometry has no letter-spacing of its own)
            const tracking = -0.04 * fontSize;
            const wordSpacing = 0.8 * fontSize;
            const unitsToSize = fontSize / font.data.resolution;
            const lineSpacing = fontSize * lineHeight;
            const totalHeight = (lines.length - 1) * lineSpacing;

            lines.forEach((line, index) => {
                const lineGroup = new THREE.Group();
                let cursor = 0;
                for (const char of line) {
                    const glyph = font.data.glyphs[char];
                    const advance = (glyph ? glyph.ha : font.data.resolution * 0.3) * unitsToSize;
                    if (char !== ' ' && glyph) {
                        const geometry = new TextGeometry(char, {
                            font: font,
                            size: fontSize,
                            height: 0.015,
                            bevelEnabled: true,
                            bevelThickness: 0.01,
                            bevelSize: 0.006,
                            bevelSegments: 3
                        });
                        const mesh = new THREE.Mesh(geometry, [frontMaterial.clone(), sideMaterial.clone()]);
                        mesh.position.x = cursor;
                        lineGroup.add(mesh);
                    }
                    // words open up by half an em, matching the tagline's word-spacing: 0.5em
                    cursor += advance + tracking + (char === ' ' ? wordSpacing : 0);
                }
                const lineWidth = cursor - tracking;
                lineGroup.children.forEach((mesh) => { mesh.position.x -= lineWidth / 2; });
                lineGroup.position.y = (lines.length - 1 - index) * lineSpacing - totalHeight / 2;
                this.textGroup.add(lineGroup);
            });
            
            // Rotate 90 degrees on X axis
            this.textGroup.rotation.x = Math.PI / -2;
            
            // Animate from tall intro depth to default compressed depth
            this.textGroup.scale.z = this.textScaleIntroStartZ;
            this.textScaleIntroQueuedAt = performance.now();
            this.textScaleIntroStartTime = null;
            
            // // Add axes helper for debugging (X=red, Y=green, Z=blue)
            // const axesHelper = new THREE.AxesHelper(20);
            // this.textGroup.add(axesHelper);
            
            this.scene.add(this.textGroup);
        });
        
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true
        });
        this.renderer.autoClear = false;
        this.map = map;
    },
    
    render(gl, args) {
        // Animate rect area light position
        if (this.rectAreaLight) {
            const elapsed = (Date.now() - this.lightAnimationStartTime) / 1000; // Convert to seconds
            
            // Circular motion around the text
            const radius = 20;
            const speed = 0.5; // Rotation speed
            const x = Math.cos(elapsed * speed) * radius;
            const z = Math.sin(elapsed * speed) * radius;
            const y = 10 + Math.sin(elapsed * speed * 0.7) * 5; // Vertical oscillation
            
            this.rectAreaLight.position.set(x, y, z);
            this.rectAreaLight.lookAt(0, 0, 0); // Always point towards the text center
        }

        if (this.textGroup && typeof this.textScaleIntroStartTime === 'number') {
            const elapsedMs = performance.now() - this.textScaleIntroStartTime;
            const progress = Math.min(1, elapsedMs / this.textScaleIntroDurationMs);
            const easedProgress = easeOutCubic(progress);
            this.textGroup.scale.z = lerp(this.textScaleIntroStartZ, this.textScaleIntroEndZ, easedProgress);

            if (progress >= 1) {
                this.textGroup.scale.z = this.textScaleIntroEndZ;
                this.textScaleIntroStartTime = null;
            }
        }

        if (this.textGroup && this.textScaleIntroQueuedAt !== null && this.textScaleIntroStartTime === null) {
            const queuedElapsedMs = performance.now() - this.textScaleIntroQueuedAt;
            if (queuedElapsedMs >= this.textScaleIntroDelayMs) {
                this.textScaleIntroStartTime = performance.now();
                this.textScaleIntroQueuedAt = null;
            }
        }
        
        const modelOrigin = textCoords;
        const modelAltitude = 800;
        const scaling = 5000;
        
        const modelMatrix = map.transform.getMatrixForModel(modelOrigin, modelAltitude);
        const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
        const l = new THREE.Matrix4()
            .fromArray(modelMatrix)
            .scale(new THREE.Vector3(scaling, scaling, scaling));
        
        this.camera.projectionMatrix = m.multiply(l);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
    }
};

const buttons3DLayer = {
    id: 'threejs-buttons',
    type: 'custom',
    renderingMode: '3d',
    
    onAdd(map, gl) {
        this.camera = new THREE.Camera();
        this.scene = new THREE.Scene();
        this.scene.background = null;
        this.buttonsScaleIntroStartZ = 0.42;
        this.buttonsScaleIntroEndZ = 0.0024;
        this.buttonsScaleIntroDurationMs = 2600;
        this.buttonsScaleIntroDelayMs = 500;
        this.buttonsScaleIntroQueuedAt = null;
        this.buttonsScaleIntroStartTime = null;
        
        const ambientLight = new THREE.AmbientLight(0xffffff, 2);
        this.scene.add(ambientLight);
        
        const rectAreaLight = new THREE.RectAreaLight(0xffffff, 10, 10, 100);
        rectAreaLight.position.set(0, 0, 0);
        rectAreaLight.lookAt(0, 0, 0);
        this.scene.add(rectAreaLight);
        this.rectAreaLight = rectAreaLight;
        
        this.lightAnimationStartTime = Date.now();
        
            // Materials
            const frontMaterial = new THREE.MeshStandardMaterial({ 
                color: 0xffffff,
                metalness: 0.0,
                roughness: 0.9
            });
            
            const sideMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x333333,
                metalness: 0.0,
                roughness: 0.9
            });
            
            // Special materials for main button (PRESS P)
            const mainButtonFrontMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x089BDF, // Blue front
                metalness: 0.0,
                roughness: 0.9
            });
            
            const mainButtonSideMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x223B68, // Dark blue sides
                metalness: 0.0,
                roughness: 0.9
            });
        
        // Create buttons group
        this.buttonsGroup = new THREE.Group();
        
        // Store button meshes for click detection
        this.buttonMeshes = [];
        this.textMeshes = []; // Store text meshes for click detection too
        this.buttonAnimations = []; // Store animation state for each button
        
        // Set up raycasting for click detection
        this.raycaster = new THREE.Raycaster();
        this.raycaster.near = 0.1;
        this.raycaster.far = 10000;
        this.mouse = new THREE.Vector2();
        
        // Create a PerspectiveCamera for raycasting (will be updated each frame)
        this.raycastCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000);
        
        // Click handler
        this.handleClick = (e) => {
            if (!this.buttonMeshes || this.buttonMeshes.length === 0 || !this.camera.projectionMatrix) {
                return;
            }
            
            const rect = map.getCanvas().getBoundingClientRect();
            const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            const mouse = new THREE.Vector2(mouseX, mouseY);
            
            // Manually construct the ray from mouse coordinates using projection matrix
            const projInverse = new THREE.Matrix4().copy(this.camera.projectionMatrix).invert();
            
            // Create ray in normalized device coordinates
            const ndcNear = new THREE.Vector4(mouse.x, mouse.y, -1, 1);
            const worldNear = ndcNear.applyMatrix4(projInverse);
            worldNear.divideScalar(worldNear.w);
            
            const ndcFar = new THREE.Vector4(mouse.x, mouse.y, 1, 1);
            const worldFar = ndcFar.applyMatrix4(projInverse);
            worldFar.divideScalar(worldFar.w);
            
            // Set up the ray
            this.raycaster.ray.origin.set(worldNear.x, worldNear.y, worldNear.z);
            const dir = new THREE.Vector3(worldFar.x - worldNear.x, worldFar.y - worldNear.y, worldFar.z - worldNear.z);
            dir.normalize();
            this.raycaster.ray.direction.copy(dir);
            
            // Update button meshes world matrices for raycasting
            this.buttonsGroup.updateMatrixWorld(true);
            
            // Check intersections with button group (includes both boxes and text)
            let intersects = this.raycaster.intersectObjects([this.buttonsGroup], true);
            
            if (intersects.length === 0) {
                // Fallback: try individual meshes
                const allClickableMeshes = [...this.buttonMeshes, ...this.textMeshes];
                intersects = this.raycaster.intersectObjects(allClickableMeshes, true);
            }
            
            if (intersects.length > 0) {
                const clickedObject = intersects[0].object;
                let buttonIndex = -1;
                
                // Check if clicked object is a text mesh
                const textIndex = this.textMeshes.indexOf(clickedObject);
                if (textIndex !== -1) {
                    buttonIndex = textIndex;
                } else {
                    // Check if clicked object is a button mesh
                    buttonIndex = this.buttonMeshes.indexOf(clickedObject);
                    
                    // If not found, traverse up the parent chain
                    if (buttonIndex === -1) {
                        let clickedButton = clickedObject;
                        while (clickedButton && clickedButton.parent && clickedButton !== this.buttonsGroup) {
                            buttonIndex = this.buttonMeshes.indexOf(clickedButton);
                            if (buttonIndex !== -1) break;
                            clickedButton = clickedButton.parent;
                        }
                    }
                }
                
                if (buttonIndex !== -1) {
                    this.animateButtonPress(buttonIndex);
                    
                    // Button 0 is the main journey button - trigger journey toggle
                    if (buttonIndex === 0) {
                        toggleJourney();
                    }
                    // Button 1 (PROJECTS) - enter projects mode (manual exploration)
                    else if (buttonIndex === 1) {
                        gtag('event', 'projects_opened');
                        enterProjectsMode();
                    }
                    // Button 2 is SKILLS - fly to chart
                    else if (buttonIndex === 2) {
                        gtag('event', 'skills_opened');
                        map.flyTo({
                            center: chartFlyToCoords,
                            zoom: 10.4,
                            bearing: 0,
                            pitch: 60,
                            duration: 2000
                        });
                        customLayer.spinBurstStartTime = Date.now();
                    }
                }
            }
        };
        
        map.getCanvas().addEventListener('click', this.handleClick);
        
        // Load font for button text
        const fontLoader = new FontLoader();
        fontLoader.load('/fonts/Quantico_Bold.json', (font) => {
            // Text material with blue sides
            const buttonTextSideMaterial = new THREE.MeshStandardMaterial({ 
                color: 0x223B68, // Dark blue sides for text
                metalness: 0.0,
                roughness: 0.9
            });
            
            const buttonHeight = 0.3;
            const buttonDepth = 100; // Increased depth for more extrusion
            const buttonSpacing = 0.3; // Reduced spacing between buttons
            
            // Detect if mobile
            const isMobile = window.innerWidth <= 640;
            
            // Button texts
            const mainButtonText = isMobile ? 'PRESS TO START JOURNEY' : 'PRESS P TO START JOURNEY';
            const buttonTexts = [mainButtonText, 'PROJECTS', 'SKILLS'];
            const buttonWidths = [2, 1, 0.7]; // Widths for each button
            
            buttonTexts.forEach((text, index) => {
                // Create button box
                const boxGeometry = new THREE.BoxGeometry(buttonWidths[index], buttonHeight, buttonDepth);
                
                // All buttons use the same blue colors
                const buttonMesh = new THREE.Mesh(boxGeometry, [
                    mainButtonSideMaterial.clone(), // Left
                    mainButtonSideMaterial.clone(), // Right
                    mainButtonFrontMaterial.clone(), // Front
                    mainButtonSideMaterial.clone(), // Back
                    mainButtonSideMaterial.clone(), // Top
                    mainButtonSideMaterial.clone()  // Bottom
                ]);
                
                // Position buttons horizontally
                const totalWidth = buttonWidths.reduce((a, b) => a + b, 0) + buttonSpacing * (buttonTexts.length - 1);
                const startX = -totalWidth / 2;
                let currentX = startX;
                for (let i = 0; i < index; i++) {
                    currentX += buttonWidths[i] + buttonSpacing;
                }
                buttonMesh.position.x = currentX + buttonWidths[index] / 2;
                buttonMesh.position.y = 0;
                buttonMesh.position.z = 0;
                
                // Add text to button front face
                const textGeometry = new TextGeometry(text, {
                    font: font,
                    size: 0.08,
                    height: 0.01,
                    bevelEnabled: true,
                    bevelThickness: 0.002,
                    bevelSize: 0.001,
                    bevelSegments: 3
                });
                
                // Center text
                textGeometry.computeBoundingBox();
                const textWidth = textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x;
                const textHeight = textGeometry.boundingBox.max.y - textGeometry.boundingBox.min.y;
                textGeometry.translate(-textWidth / 2, -textHeight / 2, buttonDepth / 2 + 0.001);
                
                const textMesh = new THREE.Mesh(textGeometry, [frontMaterial.clone(), buttonTextSideMaterial.clone()]);
                textMesh.position.copy(buttonMesh.position);
                // Set text scale to 0.0006 (compensate for button group scale of 0.0024)
                // Effective scale = textMesh.scale.z * buttonsGroup.scale.z = 0.0006
                // So textMesh.scale.z = 0.0006 / 0.0024 = 0.25
                textMesh.scale.z = 0.54;
                
                // Store button mesh and text mesh references for click detection
                this.buttonMeshes.push(buttonMesh);
                this.textMeshes.push(textMesh); // Store text mesh too
                this.buttonAnimations.push({ 
                    isAnimating: false, 
                    startTime: 0,
                    originalScale: 1
                });
                
                this.buttonsGroup.add(buttonMesh);
                this.buttonsGroup.add(textMesh);
            });
            
            // Rotate 90 degrees on X axis (same as text)
            this.buttonsGroup.rotation.x = Math.PI / -2;
            this.buttonsGroup.scale.z = this.buttonsScaleIntroEndZ;
            this.buttonsGroup.scale.x = 2; // X scale (adjust as needed)
            this.buttonsGroup.scale.y = 2; // Y scale (adjust as needed)
            this.buttonsGroup.position.z = 0.7;

            const introRatio = this.buttonsScaleIntroStartZ / this.buttonsScaleIntroEndZ;
            this.buttonIntroStates = this.buttonMeshes.map((buttonMesh, index) => {
                const textMesh = this.textMeshes[index];
                const buttonBaseZ = buttonMesh.scale.z;
                const textBaseZ = textMesh ? textMesh.scale.z : 1;
                buttonMesh.scale.z = buttonBaseZ * introRatio;
                if (textMesh) textMesh.scale.z = textBaseZ * introRatio;
                return {
                    queuedAt: performance.now(),
                    delay: this.buttonsScaleIntroDelayMs + index * 200,
                    startTime: null,
                    done: false,
                    buttonBaseZ,
                    textBaseZ
                };
            });
            
            this.scene.add(this.buttonsGroup);
        });
        
        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true
        });
        this.renderer.autoClear = false;
        this.map = map;
    },
    
    animateButtonPress(buttonIndex) {
        if (!this.buttonAnimations[buttonIndex] || this.buttonAnimations[buttonIndex].isAnimating) return; // Prevent multiple animations
        
        this.buttonAnimations[buttonIndex].isAnimating = true;
        this.buttonAnimations[buttonIndex].startTime = Date.now();
        this.buttonAnimations[buttonIndex].originalScale = this.buttonMeshes[buttonIndex].scale.z;
    },
    
    render(gl, args) {
        // Update camera first (needed for raycasting)
        const modelOrigin = buttonCoords;
        const modelAltitude = 800;
        const scaling = 5000;
        
        const modelMatrix = map.transform.getMatrixForModel(modelOrigin, modelAltitude);
        const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
        const l = new THREE.Matrix4()
            .fromArray(modelMatrix)
            .scale(new THREE.Vector3(scaling, scaling, scaling));
        
        this.camera.projectionMatrix = m.multiply(l);
        // Store inverse for raycasting
        this.camera.projectionMatrixInverse = new THREE.Matrix4().copy(this.camera.projectionMatrix).invert();
        
        // Update raycast camera for click detection
        if (this.raycastCamera) {
            this.raycastCamera.projectionMatrix.copy(this.camera.projectionMatrix);
            this.raycastCamera.projectionMatrixInverse.copy(this.camera.projectionMatrixInverse);
            this.raycastCamera.matrixWorldInverse.identity();
        }
        
        // Animate button presses
        if (this.buttonMeshes && this.buttonAnimations) {
            this.buttonMeshes.forEach((buttonMesh, index) => {
                const anim = this.buttonAnimations[index];
                if (anim && anim.isAnimating) {
                    const elapsed = Date.now() - anim.startTime;
                    const duration = 300; // Animation duration in ms
                    
                    if (elapsed < duration) {
                        const progress = elapsed / duration;
                        // Ease out cubic for smooth animation
                        const eased = 1 - Math.pow(1 - progress, 3);
                        
                        // Scale down to 0.7, then back to 1
                        let scale;
                        if (progress < 0.5) {
                            // Press down
                            scale = THREE.MathUtils.lerp(anim.originalScale, 0.7, eased * 2);
                        } else {
                            // Spring back
                            scale = THREE.MathUtils.lerp(0.7, anim.originalScale, (eased - 0.5) * 2);
                        }
                        
                        buttonMesh.scale.z = scale;
                        this.map.triggerRepaint();
                    } else {
                        // Animation complete
                        buttonMesh.scale.z = anim.originalScale;
                        anim.isAnimating = false;
                    }
                }
            });
        }

        if (this.buttonIntroStates && this.buttonMeshes) {
            this.buttonIntroStates.forEach((state, index) => {
                if (state.done) return;
                const buttonMesh = this.buttonMeshes[index];
                const textMesh = this.textMeshes[index];
                if (!buttonMesh) return;

                if (state.startTime === null) {
                    if (performance.now() - state.queuedAt >= state.delay) {
                        state.startTime = performance.now();
                    }
                    return;
                }

                const elapsed = performance.now() - state.startTime;
                const progress = Math.min(1, elapsed / this.buttonsScaleIntroDurationMs);
                const easedProgress = easeOutCubic(progress);
                const introRatio = this.buttonsScaleIntroStartZ / this.buttonsScaleIntroEndZ;
                buttonMesh.scale.z = lerp(state.buttonBaseZ * introRatio, state.buttonBaseZ, easedProgress);
                if (textMesh) textMesh.scale.z = lerp(state.textBaseZ * introRatio, state.textBaseZ, easedProgress);

                if (progress >= 1) {
                    buttonMesh.scale.z = state.buttonBaseZ;
                    if (textMesh) textMesh.scale.z = state.textBaseZ;
                    state.done = true;
                }
            });
        }
        
        // Animate rect area light position
        if (this.rectAreaLight) {
            const elapsed = (Date.now() - this.lightAnimationStartTime) / 1000;
            const radius = 20;
            const speed = 0.5;
            const x = Math.cos(elapsed * speed) * radius;
            const z = Math.sin(elapsed * speed) * radius;
            const y = 10 + Math.sin(elapsed * speed * 0.7) * 5;
            
            this.rectAreaLight.position.set(x, y, z);
            this.rectAreaLight.lookAt(0, 0, 0);
        }
        
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.map.triggerRepaint();
    }
};

map.on('style.load', () => {
    map.addLayer(customLayer);
    map.addLayer(text3DLayer);
    map.addLayer(buttons3DLayer);
});

map.on('load', () => {
    addMarkers();
    addProjectMarkers();
    preloadProjectPopupImages();
    ensureProjectDetailModalElements();
    setupRotationToggle();
    setupJourneyToggle();
    
    updateJourneyDate('');

    document.addEventListener('mousedown', () => handleUserInteraction());
    document.addEventListener('click', () => handleUserInteraction());

    map.flyTo({
        center: textCoords,
        zoom: 9.5,
        bearing: 10,
        pitch: 30,
        duration: 3000
    });
    currentTextIndex = 0;
    updateJourneyText(dynamicTexts[0]);
    checkAndStartTextRotation();
});

// Idle auto-start: 5s with no input shows a 5..1 countdown on the journey button,
// then enters Projects mode. Any input cancels it. Once per visit, and never after
// the visitor has started the Journey or Projects themselves.
const AUTO_PROJECTS_IDLE_MS = 5000;
let autoProjectsDone = false;
let autoIdleTimer = null;
let autoCountdownTimer = null;

function autoProjectsAllowed() {
    if (appMode !== APP_MODES.IDLE || isJourneyActive) {
        autoProjectsDone = true;
    }
    return !autoProjectsDone && !prefersReducedMotion && !isProjectDetailModalOpen();
}

function cancelAutoCountdown() {
    if (autoCountdownTimer) {
        clearInterval(autoCountdownTimer);
        autoCountdownTimer = null;
        updateJourneyButtonText();
    }
}

function startAutoCountdown() {
    const button = document.getElementById('journey-toggle');
    if (!button || !autoProjectsAllowed()) {
        return;
    }
    let remaining = 5;
    const show = () => { button.textContent = `PROJECTS IN ${remaining}`; };
    show();
    autoCountdownTimer = setInterval(() => {
        remaining--;
        if (remaining > 0) {
            show();
            return;
        }
        clearInterval(autoCountdownTimer);
        autoCountdownTimer = null;
        autoProjectsDone = true;
        enterProjectsMode();
        if (typeof gtag === 'function') {
            gtag('event', 'auto_projects');
        }
    }, 1000);
}

function armAutoProjects() {
    clearTimeout(autoIdleTimer);
    if (autoProjectsAllowed()) {
        autoIdleTimer = setTimeout(startAutoCountdown, AUTO_PROJECTS_IDLE_MS);
    }
}

['mousemove', 'keydown', 'wheel', 'touchstart', 'pointerdown'].forEach((type) => {
    window.addEventListener(type, () => {
        if (autoProjectsDone) {
            return;
        }
        cancelAutoCountdown();
        armAutoProjects();
    }, { passive: true, capture: true });
});

if (document.readyState === 'complete') {
    armAutoProjects();
} else {
    window.addEventListener('load', armAutoProjects);
}

// Tab life: the favicon breathes through the spinner glyphs about once a second (Chrome
// throttles background tabs to that anyway), and the title calls them back while away.
// Safari ignores favicon swaps and keeps the static spark; reduced motion keeps it still.
(() => {
    const link = document.querySelector('link[rel="icon"]');
    const frames = ['·', '✢', '✳', '✶', '✻', '✽'];
    const sequence = [...frames, ...frames.slice(1, -1).reverse()];
    const draw = (glyph) => {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        const r = size * 0.18;
        ctx.fillStyle = '#0B0E12';
        ctx.beginPath();
        ctx.roundRect(0, 0, size, size, r);
        ctx.fill();
        ctx.fillStyle = '#DDE7EC';
        if (glyph === '·') {
            // the dot isn't in the dingbat font, so draw it centred
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size * 0.07, 0, Math.PI * 2);
            ctx.fill();
            return canvas.toDataURL('image/png');
        }
        ctx.font = `${size * 0.8}px "Zapf Dingbats", "Apple Symbols", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyph + '\uFE0E', size / 2, size * 0.56);
        return canvas.toDataURL('image/png');
    };

    if (link && !prefersReducedMotion && CanvasRenderingContext2D.prototype.roundRect) {
        const urls = sequence.map(draw);
        let tick = 0;
        setInterval(() => {
            tick = (tick + 1) % urls.length;
            link.href = urls[tick];
        }, 1000);
    }

    const title = document.title;
    document.addEventListener('visibilitychange', () => {
        document.title = document.hidden ? '✽ come back' : title;
        const videos = document.querySelectorAll('video.info-popup-image');
        if (document.hidden) {
            videos.forEach((video) => video.pause());
        } else if (videos.length && !map.isMoving()) {
            videos[videos.length - 1].play().catch(() => {});
        }
    });
})();
