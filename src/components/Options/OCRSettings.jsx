import React, { useState, useEffect } from 'react';
import { getSupportedOCRProviders } from '../../api/ocr';

/**
 * OCR设置组件
 * @param {Object} props - 组件属性
 * @param {Object} props.config - 当前配置
 * @param {Function} props.updateConfig - 更新配置的回调函数
 */
const OCRSettings = ({ config, updateConfig }) => {
  const [loading, setLoading] = useState(false);
  const [providers, setProviders] = useState([]);
  const [ocrSettings, setOcrSettings] = useState(config.ocrSettings || {
    preferredMethod: 'auto',
    tesseract: {
      language: 'jpn',
      preprocess: true,
      workerCount: 1
    }
  });

  // 加载OCR提供者信息
  useEffect(() => {
    const loadProviders = async () => {
      try {
        setLoading(true);
        const supportedProviders = getSupportedOCRProviders();
        setProviders(supportedProviders);
      } catch (error) {
        console.error('加载OCR提供者失败:', error);
      } finally {
        setLoading(false);
      }
    };

    loadProviders();
  }, []);

  // 当配置更新时，更新本地状态
  useEffect(() => {
    if (config.ocrSettings) {
      setOcrSettings(config.ocrSettings);
    }
  }, [config.ocrSettings]);

  // 处理OCR方法变更
  const handleMethodChange = (e) => {
    const method = e.target.value;
    setOcrSettings(prev => ({
      ...prev,
      preferredMethod: method
    }));

    updateConfig({
      ocrSettings: {
        ...ocrSettings,
        preferredMethod: method
      }
    });
  };

  // 处理Tesseract设置变更
  const handleTesseractChange = (field, value) => {
    const newTesseractSettings = {
      ...ocrSettings.tesseract,
      [field]: value
    };

    setOcrSettings(prev => ({
      ...prev,
      tesseract: newTesseractSettings
    }));

    updateConfig({
      ocrSettings: {
        ...ocrSettings,
        tesseract: newTesseractSettings
      }
    });
  };

  return (
    <div className="mt-6 border rounded-lg p-4 shadow-sm">
      <h3 className="text-lg font-semibold mb-4">OCR文字识别设置</h3>
      
      {loading ? (
        <div className="flex justify-center my-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-800"></div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* OCR方法选择 */}
          <div>
            <label className="block text-sm font-medium mb-1">
              首选OCR方法
            </label>
            <select
              value={ocrSettings.preferredMethod}
              onChange={handleMethodChange}
              className="w-full p-2 border rounded-md bg-white"
            >
              <option value="auto">自动（推荐）</option>
              <option value="tesseract">仅使用Tesseract.js（本地OCR）</option>
              <option value="api">仅使用API（远程OCR）</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              自动模式将先尝试使用本地OCR，如果失败再使用API。这通常能提供最佳的成功率。
            </p>
          </div>

          {/* Tesseract设置（当选择Tesseract或自动模式时显示） */}
          {(ocrSettings.preferredMethod === 'tesseract' || ocrSettings.preferredMethod === 'auto') && (
            <div className="mt-4 border-t pt-4">
              <h4 className="text-md font-medium mb-3">Tesseract.js设置</h4>
              
              {/* 识别语言 */}
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">
                  识别语言
                </label>
                <select
                  value={ocrSettings.tesseract?.language || 'jpn'}
                  onChange={(e) => handleTesseractChange('language', e.target.value)}
                  className="w-full p-2 border rounded-md bg-white"
                >
                  <option value="jpn">日语</option>
                  <option value="eng">英语</option>
                  <option value="chi_sim">简体中文</option>
                  <option value="chi_tra">繁体中文</option>
                  <option value="kor">韩语</option>
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  选择漫画原文的语言，以提高识别准确率
                </p>
              </div>
              
              {/* 图像预处理 */}
              <div className="mb-3">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={ocrSettings.tesseract?.preprocess || false}
                    onChange={(e) => handleTesseractChange('preprocess', e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium">启用图像预处理</span>
                </label>
                <p className="mt-1 text-xs text-gray-500 ml-6">
                  预处理图像可以提高OCR识别率，但可能会增加处理时间
                </p>
              </div>
              
              {/* 工作线程数 */}
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">
                  工作线程数
                </label>
                <input
                  type="number"
                  min="1"
                  max="4"
                  value={ocrSettings.tesseract?.workerCount || 1}
                  onChange={(e) => handleTesseractChange('workerCount', parseInt(e.target.value, 10))}
                  className="w-full p-2 border rounded-md"
                />
                <p className="mt-1 text-xs text-gray-500">
                  增加工作线程可以加快处理速度，但会占用更多内存（推荐1-2）
                </p>
              </div>
              
              <div className="p-3 bg-blue-50 rounded-md mt-4">
                <p className="text-sm text-blue-700">
                  <strong>提示：</strong> 第一次使用Tesseract时会下载语言数据（约10-20MB），可能需要一点时间。下载后会缓存在本地，后续使用将更快。
                </p>
              </div>
            </div>
          )}
          
          {/* API设置说明（当选择API或自动模式时显示） */}
          {(ocrSettings.preferredMethod === 'api' || ocrSettings.preferredMethod === 'auto') && (
            <div className="mt-4 border-t pt-4">
              <h4 className="text-md font-medium mb-3">API OCR设置</h4>
              <p className="text-sm text-gray-600">
                API OCR使用您在API设置中配置的AI服务提供商（OpenAI、Claude等）来识别文字。
                确保您已在API设置中正确配置了API密钥和其他选项。
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OCRSettings; 