figma.showUI(__html__, { width: 400, height: 470 });

/** Отступ между правым краем шаблона и блоком GENERATED */
const GENERATED_GAP = 40;

/** Запрос остановки текущей генерации (кнопка «Прервать» в UI). */
let cancelGenerationRequested = false;

/**
 * @param {string | undefined} raw
 * @returns {string}
 */
function resolveTemplateName(raw) {
    if (typeof raw !== 'string') return 'TEMPLATE';
    const t = raw.trim();
    return t.length > 0 ? t : 'TEMPLATE';
}

/**
 * @param {string} templateName
 * @returns {SceneNode | null}
 */
function findTemplateNode(templateName) {
    return figma.currentPage.findOne((node) => node.name === templateName);
}

/*
 * Темы из кода — на будущее; сейчас стили только из макета.
 *
 * const PROJECT_THEMES = {
 *     dewalt: {
 *         bg: { r: 1, g: 0.796, b: 0.02 },
 *         logo: '',
 *         fonts: {
 *             title: { family: 'Inter', style: 'Bold' },
 *             default: { family: 'Inter', style: 'Regular' },
 *         },
 *     },
 *     makita: {
 *         bg: { r: 0.094, g: 0.565, b: 0.647 },
 *         logo: '',
 *         fonts: {
 *             title: { family: 'Arial', style: 'Bold' },
 *             default: { family: 'Arial', style: 'Regular' },
 *         },
 *     },
 *     grohe: {
 *         bg: { r: 0, g: 0.451, b: 0.745 },
 *         logo: '',
 *         fonts: {
 *             title: { family: 'Roboto Condensed', style: 'Bold' },
 *             default: { family: 'Roboto Condensed', style: 'Regular' },
 *         },
 *     },
 * };
 *
 * function getProjectTheme(project) {
 *     const t = PROJECT_THEMES[project];
 *     return t != null ? t : PROJECT_THEMES.dewalt;
 * }
 *
 * function applyProjectBg(root, color) {
 *     const hasDataMarker = (n) => n.name.toLowerCase().includes('[data]');
 *     const dataNodes = [];
 *     if (hasDataMarker(root)) dataNodes.push(root);
 *     dataNodes.push(...root.findAll(hasDataMarker));
 *     for (const node of dataNodes) {
 *         const name = node.name.toLowerCase();
 *         const parts = name.split('[data]');
 *         const key = parts[1] ? parts[1].trim() : null;
 *         if (key !== 'bg') continue;
 *         const target = resolveImageFillTarget(node);
 *         if (!target) continue;
 *         target.fills = [{ type: 'SOLID', color }];
 *     }
 * }
 *
 * async function applyThemeLogo(root, imageUrl) {
 *     const hasDataMarker = (n) => n.name.toLowerCase().includes('[data]');
 *     const dataNodes = [];
 *     if (hasDataMarker(root)) dataNodes.push(root);
 *     dataNodes.push(...root.findAll(hasDataMarker));
 *     for (const node of dataNodes) {
 *         const name = node.name.toLowerCase();
 *         const parts = name.split('[data]');
 *         const key = parts[1] ? parts[1].trim() : null;
 *         if (key !== 'logo') continue;
 *         await applyImageFill(node, imageUrl);
 *     }
 * }
 *
 * async function applyThemeFonts(root, theme) {
 *     if (!theme.fonts) return;
 *     const hasDataMarker = (n) => n.name.toLowerCase().includes('[data]');
 *     const dataNodes = [];
 *     if (hasDataMarker(root)) dataNodes.push(root);
 *     dataNodes.push(...root.findAll(hasDataMarker));
 *     for (const node of dataNodes) {
 *         if (node.type !== 'TEXT') continue;
 *         const name = node.name.toLowerCase();
 *         const parts = name.split('[data]');
 *         const key = parts[1] ? parts[1].trim() : null;
 *         if (!key) continue;
 *         const fn = theme.fonts[key] || theme.fonts.default;
 *         if (!fn) continue;
 *         try {
 *             await figma.loadFontAsync(fn);
 *             node.fontName = fn;
 *         } catch (e) {
 *             console.log('Theme font:', key, e);
 *         }
 *     }
 * }
 *
 * async function applyProjectTheme(root, theme) {
 *     applyProjectBg(root, theme.bg);
 *     if (theme.logo && isImageSource(theme.logo)) {
 *         try {
 *             await applyThemeLogo(root, theme.logo);
 *         } catch (e) {
 *             console.log('Theme logo:', e);
 *             figma.notify(
 *                 'Логотип темы: ' +
 *                     (e && e.message ? e.message : String(e)),
 *                 { error: true }
 *             );
 *         }
 *     }
 *     await applyThemeFonts(root, theme);
 * }
 */

/** @param {unknown} value */
function isImageSource(value) {
    if (typeof value !== 'string') return false;
    const v = value.trim();
    return (
        v.startsWith('http://') ||
        v.startsWith('https://') ||
        v.startsWith('data:image') ||
        v.startsWith('//')
    );
}

/**
 * Не URL — ссылка на слой Figma: точное имя или префикс figma: для явности.
 * @param {unknown} value
 * @returns {string | null} имя слоя или null если не задано / это URL
 */
function parseFigmaImageLayerName(value) {
    if (typeof value !== 'string') return null;
    const t = value.trim();
    if (t.length === 0) return null;
    if (isImageSource(value)) return null;
    if (t.toLowerCase().startsWith('figma:')) {
        const rest = t.slice(6).trim();
        return rest.length > 0 ? rest : null;
    }
    return t;
}

/** Маркер фрейма-обёртки: при null по полю key узел скрывается (visible = false). */
const DATA_GROUP_MARKER = '[data][group]';

/**
 * Имя вида …[data][group]fieldKey — обёртка для блока с [data]fieldKey внутри.
 * @param {string} nodeName
 * @returns {string | null} ключ поля из фида
 */
function parseDataGroupFieldKey(nodeName) {
    const lower = nodeName.toLowerCase();
    const idx = lower.indexOf(DATA_GROUP_MARKER);
    if (idx === -1) return null;
    const key = nodeName.slice(idx + DATA_GROUP_MARKER.length).trim();
    return key.length > 0 ? key : null;
}

/**
 * @param {SceneNode} node
 * @returns {number}
 */
function getNodeDepth(node) {
    let d = 0;
    let n = node;
    while (n.parent) {
        d++;
        n = n.parent;
    }
    return d;
}

/**
 * Скрывает фреймы с [data][group]key, если item[key] — null/undefined.
 * Сначала глубокие узлы, чтобы вложенные группы корректно скрывались.
 * @param {SceneNode} root
 * @param {Record<string, unknown>} item
 */
function hideDataGroupsForNullFields(root, item) {
    const hasGroupMarker = (n) =>
        n.name.toLowerCase().includes(DATA_GROUP_MARKER);
    const nodes = [];
    if (hasGroupMarker(root)) nodes.push(root);
    nodes.push(...root.findAll(hasGroupMarker));
    nodes.sort((a, b) => getNodeDepth(b) - getNodeDepth(a));
    for (const node of nodes) {
        const key = parseDataGroupFieldKey(node.name);
        if (!key) continue;
        const value = item[key];
        if (value !== undefined && value !== null) continue;
        try {
            node.visible = false;
        } catch (e) {
            console.log('Скрытие [data][group]:', node.name, e);
        }
    }
}

/**
 * Первый слой с именем на текущей странице (как findOne).
 * Референс кладите с уникальным именем рядом с макетом на той же странице.
 * @param {string} layerName
 * @returns {string | null} imageHash
 */
function getImageHashFromNamedLayer(layerName) {
    const source = figma.currentPage.findOne((n) => n.name === layerName);
    if (!source) return null;
    const target = resolveImageFillTarget(source);
    if (!target || !('fills' in target) || target.fills === figma.mixed) {
        return null;
    }
    const fills = target.fills;
    for (let i = 0; i < fills.length; i++) {
        const fill = fills[i];
        if (fill.type === 'IMAGE' && fill.imageHash) {
            return fill.imageHash;
        }
    }
    return null;
}

/**
 * Копирует картинку из слоя на странице по имени (без загрузки по сети).
 * При отсутствии слоя или заливки — false, без исключений (генерация не прерывается).
 * @param {SceneNode} node
 * @param {string} layerName
 * @returns {boolean}
 */
function applyImageFillFromNamedLayer(node, layerName) {
    const dest = resolveImageFillTarget(node);
    if (!dest) {
        console.log(
            'Пропуск картинки: нет цели заливки для «' + node.name + '»'
        );
        return false;
    }
    const imageHash = getImageHashFromNamedLayer(layerName);
    if (!imageHash) {
        const found = figma.currentPage.findOne((n) => n.name === layerName);
        if (!found) {
            console.log(
                'Пропуск картинки: слой «' + layerName + '» не на странице'
            );
        } else {
            console.log(
                'Пропуск картинки: у «' +
                    layerName +
                    '» нет заливки IMAGE'
            );
        }
        return false;
    }
    dest.fills = [
        {
            type: 'IMAGE',
            imageHash: imageHash,
            scaleMode: 'FIT',
        },
    ];
    return true;
}

/**
 * Слот с [data]… в клоне: скрыть при отсутствии данных / ошибке (картинка, текст).
 * @param {SceneNode} dataMarkerNode
 */
function hideDataMarkerNode(dataMarkerNode) {
    try {
        dataMarkerNode.visible = false;
    } catch (e) {
        console.log('Не удалось скрыть слой:', dataMarkerNode.name, e);
    }
}

/**
 * createImageAsync принимает строку: URL (http/https) или data URL к PNG/JPEG/GIF.
 * @see https://www.figma.com/plugin-docs/api/properties/figma-createimageasync/
 * @param {string} value
 * @returns {Promise<Image>}
 */
async function createImageFromSrc(value) {
    const v = value.trim();
    const src = v.startsWith('//') ? 'https:' + v : v;
    return figma.createImageAsync(src);
}

/**
 * У группы/обёртки нет fills — картинка на дочернем прямоугольнике/фрейме.
 * TEXT исключаем: у текста fills — цвет букв, не картинка.
 * @param {SceneNode} node
 * @returns {SceneNode | null}
 */
function resolveImageFillTarget(node) {
    if (node.type === 'TEXT') return null;
    if ('fills' in node && node.fills !== figma.mixed) return node;
    if (!('children' in node)) return null;
    for (const child of node.children) {
        const found = resolveImageFillTarget(child);
        if (found) return found;
    }
    return null;
}

/**
 * @param {SceneNode} node
 * @param {string} value
 * @returns {Promise<boolean>} false — нет цели заливки
 */
async function applyImageFill(node, value) {
    const target = resolveImageFillTarget(node);
    if (!target) {
        console.log(
            'Пропуск URL-картинки: нет цели заливки для «' + node.name + '»'
        );
        return false;
    }
    const image = await createImageFromSrc(value);
    target.fills = [
        {
            type: 'IMAGE',
            imageHash: image.hash,
            scaleMode: 'FIT',
        },
    ];
    return true;
}

figma.ui.onmessage = async (msg) => {
    if (msg.type === 'cancel-generate') {
        cancelGenerationRequested = true;
        return;
    }

    if (msg.type === 'preview-project') {
        const templateName = resolveTemplateName(msg.templateName);
        const template = findTemplateNode(templateName);
        if (!template) {
            figma.notify('Шаблон «' + templateName + '» не найден');
            return;
        }
        /* Стили из макета; applyProjectTheme / PROJECT_THEMES отключены */
        return;
    }

    if (msg.type === 'generate') {
        cancelGenerationRequested = false;
        const data = msg.data;
        const templateName = resolveTemplateName(msg.templateName);

        const template = findTemplateNode(templateName);

        if (!template) {
            figma.notify('Шаблон «' + templateName + '» не найден');
            return;
        }

        const container = figma.createFrame();

        container.name = 'GENERATED';
        container.fills = [
            {
                type: 'SOLID',
                color: { r: 0, g: 0, b: 0 },
                opacity: 0,
            },
        ];
        container.layoutMode = 'HORIZONTAL';
        container.primaryAxisSizingMode = 'AUTO';
        container.counterAxisSizingMode = 'AUTO';
        container.itemSpacing = 40;

        const box = template.absoluteBoundingBox;
        if (box) {
            container.x = box.x + box.width + GENERATED_GAP;
            container.y = box.y;
        } else {
            container.x = 0;
            container.y = 0;
        }

        figma.currentPage.appendChild(container);

        const nameField =
            typeof msg.nameField === 'string' ? msg.nameField.trim() : '';

        let imageUrlLoadFailures = 0;

        generateLoop: for (const item of data) {
            if (cancelGenerationRequested) break generateLoop;

            const clone = template.clone();

            clone.x = 0;
            clone.y = 0;

            if (nameField) {
                const raw = item[nameField];
                if (raw !== undefined && raw !== null) {
                    clone.name = String(raw);
                }
            }

            container.appendChild(clone);

            hideDataGroupsForNullFields(clone, item);

            const hasDataMarker = (n) =>
                n.name.toLowerCase().includes('[data]');
            const dataNodes = [];
            if (hasDataMarker(clone)) dataNodes.push(clone);
            dataNodes.push(...clone.findAll(hasDataMarker));

            for (const node of dataNodes) {
                if (cancelGenerationRequested) break generateLoop;
                /* контейнер [data][group]key — скрытие при null выше */
                if (parseDataGroupFieldKey(node.name)) continue;

                const name = node.name.toLowerCase();
                const parts = name.split('[data]');
                const key = parts[1] ? parts[1].trim() : null;

                if (!key) continue;

                const value = item[key];

                if (node.type === 'TEXT') {
                    if (value === undefined || value === null) {
                        hideDataMarkerNode(node);
                        continue;
                    }
                    try {
                        if (cancelGenerationRequested) break generateLoop;
                        await figma.loadFontAsync(node.fontName);
                        if (cancelGenerationRequested) break generateLoop;
                        node.characters = String(value);
                    } catch (e) {
                        console.log('Font error:', node.name, e);
                        hideDataMarkerNode(node);
                    }
                    continue;
                }

                /* null / undefined — скрываем слой картинки/слота (как у текста) */
                if (value === undefined || value === null) {
                    hideDataMarkerNode(node);
                    continue;
                }

                if (isImageSource(value)) {
                    try {
                        if (cancelGenerationRequested) break generateLoop;
                        const ok = await applyImageFill(node, value);
                        if (cancelGenerationRequested) break generateLoop;
                        if (!ok) {
                            hideDataMarkerNode(node);
                        }
                    } catch (e) {
                        console.log('Image error:', node.name, key, e);
                        imageUrlLoadFailures++;
                        hideDataMarkerNode(node);
                    }
                    continue;
                }

                const figmaLayerName = parseFigmaImageLayerName(value);
                if (figmaLayerName) {
                    if (cancelGenerationRequested) break generateLoop;
                    const ok = applyImageFillFromNamedLayer(
                        node,
                        figmaLayerName
                    );
                    if (!ok) {
                        hideDataMarkerNode(node);
                    }
                }
            }

            /* await applyProjectTheme(clone, projectTheme); — стили из макета */
        }

        if (cancelGenerationRequested) {
            figma.notify('Генерация остановлена');
        } else if (imageUrlLoadFailures > 0) {
            figma.notify(
                'Готово. Не удалось загрузить ' +
                    imageUrlLoadFailures +
                    ' изображений по URL (часто CORS у хоста или неверная ссылка). Слои скрыты.',
                { timeout: 12000 }
            );
        } else {
            figma.notify('Готово 🚀');
        }
    }
};