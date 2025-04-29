/**
 * 渲染模块
 */
import { renderTranslatedImage } from '../utils/imageProcess';

/**
 * 在页面上渲染翻译结果
 * @param {HTMLImageElement} image - 原始图像元素
 * @param {Array} textAreas - 文字区域信息数组
 * @param {Array<string>} translatedTexts - 翻译后的文本数组
 * @param {Object} styleOptions - 样式选项
 * @returns {void}
 */
export function renderTranslation(image, textAreas, translatedTexts, styleOptions = {}) {
  // 创建翻译后的Canvas
  const canvas = renderTranslatedImage(image, textAreas, translatedTexts, styleOptions);
  
  // 创建包装元素
  const wrapper = document.createElement('div');
  wrapper.className = 'manga-translator-wrapper';
  wrapper.style.position = 'relative';
  wrapper.style.display = 'inline-block';
  wrapper.style.width = `${image.width}px`;
  wrapper.style.height = `${image.height}px`;
  
  // 设置Canvas样式
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.zIndex = '1';
  canvas.className = 'manga-translator-canvas';
  
  // 隐藏原图像
  image.style.opacity = '0';
  
  // 将原图像包装在容器中
  const parent = image.parentNode;
  parent.insertBefore(wrapper, image);
  wrapper.appendChild(image);
  wrapper.appendChild(canvas);
  
  // 添加控制按钮
  addControlButtons(wrapper, image, canvas);
  
  return wrapper;
}

/**
 * 添加控制按钮
 * @param {HTMLElement} wrapper - 包装元素
 * @param {HTMLImageElement} image - 原始图像
 * @param {HTMLCanvasElement} canvas - 翻译后的Canvas
 */
function addControlButtons(wrapper, image, canvas) {
  // 创建按钮容器
  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'manga-translator-controls';
  buttonContainer.style.position = 'absolute';
  buttonContainer.style.top = '5px';
  buttonContainer.style.right = '5px';
  buttonContainer.style.zIndex = '2';
  buttonContainer.style.display = 'flex';
  buttonContainer.style.flexDirection = 'column';
  buttonContainer.style.gap = '5px';
  
  // 创建切换按钮
  const toggleButton = createButton('切换', () => {
    if (canvas.style.display === 'none') {
      canvas.style.display = 'block';
      image.style.opacity = '0';
      toggleButton.textContent = '原图';
    } else {
      canvas.style.display = 'none';
      image.style.opacity = '1';
      toggleButton.textContent = '翻译';
    }
  });
  toggleButton.textContent = '原图';
  
  // 创建下载按钮
  const downloadButton = createButton('下载', () => {
    const link = document.createElement('a');
    link.download = 'translated_manga.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
  
  // 创建关闭按钮
  const closeButton = createButton('关闭', () => {
    // 恢复原图像
    image.style.opacity = '1';
    
    // 移除包装元素，保留原图像
    const parent = wrapper.parentNode;
    parent.insertBefore(image, wrapper);
    parent.removeChild(wrapper);
  });
  
  // 添加按钮到容器
  buttonContainer.appendChild(toggleButton);
  buttonContainer.appendChild(downloadButton);
  buttonContainer.appendChild(closeButton);
  
  // 添加容器到包装元素
  wrapper.appendChild(buttonContainer);
}

/**
 * 创建控制按钮
 * @param {string} text - 按钮文本
 * @param {Function} onClick - 点击事件处理函数
 * @returns {HTMLButtonElement} - 返回按钮元素
 */
function createButton(text, onClick) {
  const button = document.createElement('button');
  button.textContent = text;
  button.style.padding = '3px 8px';
  button.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  button.style.color = 'white';
  button.style.border = 'none';
  button.style.borderRadius = '3px';
  button.style.fontSize = '12px';
  button.style.cursor = 'pointer';
  button.style.transition = 'background-color 0.2s';
  
  button.addEventListener('mouseover', () => {
    button.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
  });
  
  button.addEventListener('mouseout', () => {
    button.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  });
  
  button.addEventListener('click', onClick);
  
  return button;
}

/**
 * 移除翻译渲染
 * @param {HTMLElement} wrapper - 包装元素
 */
export function removeTranslation(wrapper) {
  if (!wrapper || !wrapper.classList.contains('manga-translator-wrapper')) {
    return;
  }
  
  // 获取原图像
  const image = wrapper.querySelector('img');
  
  if (image) {
    // 恢复原图像
    image.style.opacity = '1';
    
    // 移除包装元素，保留原图像
    const parent = wrapper.parentNode;
    parent.insertBefore(image, wrapper);
    parent.removeChild(wrapper);
  }
}

/**
 * 在调试模式下显示文字区域
 * @param {HTMLImageElement} image - 图像元素
 * @param {Array} textAreas - 文字区域信息数组
 */
export function showDebugAreas(image, textAreas) {
  // 创建Canvas
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  
  const ctx = canvas.getContext('2d');
  
  // 绘制原图像
  ctx.drawImage(image, 0, 0);
  
  // 绘制文字区域
  textAreas.forEach((area, index) => {
    const { x, y, width, height, text } = area;
    
    // 随机颜色
    const hue = (index * 137) % 360;
    ctx.strokeStyle = `hsla(${hue}, 100%, 50%, 0.8)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);
    
    // 绘制区域编号
    ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.8)`;
    ctx.font = '16px Arial';
    ctx.fillText(index + 1, x + 5, y + 20);
    
    // 在控制台输出文本
    console.log(`区域 ${index + 1}:`, text);
  });
  
  // 创建包装元素
  const wrapper = document.createElement('div');
  wrapper.className = 'manga-translator-debug';
  wrapper.style.position = 'fixed';
  wrapper.style.top = '20px';
  wrapper.style.right = '20px';
  wrapper.style.zIndex = '9999';
  wrapper.style.border = '2px solid #333';
  wrapper.style.borderRadius = '5px';
  wrapper.style.backgroundColor = '#fff';
  wrapper.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
  wrapper.style.overflow = 'hidden';
  
  // 设置Canvas样式
  canvas.style.display = 'block';
  canvas.style.maxWidth = '300px';
  canvas.style.maxHeight = '300px';
  
  // 创建关闭按钮
  const closeButton = document.createElement('button');
  closeButton.textContent = '关闭';
  closeButton.style.position = 'absolute';
  closeButton.style.top = '5px';
  closeButton.style.right = '5px';
  closeButton.style.padding = '3px 8px';
  closeButton.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  closeButton.style.color = 'white';
  closeButton.style.border = 'none';
  closeButton.style.borderRadius = '3px';
  closeButton.style.fontSize = '12px';
  closeButton.style.cursor = 'pointer';
  
  closeButton.addEventListener('click', () => {
    document.body.removeChild(wrapper);
  });
  
  // 添加元素到包装器
  wrapper.appendChild(canvas);
  wrapper.appendChild(closeButton);
  
  // 添加到页面
  document.body.appendChild(wrapper);
}
