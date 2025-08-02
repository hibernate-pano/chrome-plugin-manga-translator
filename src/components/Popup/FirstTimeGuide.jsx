// import React from 'react';

/**
 * 首次使用引导组件
 * 引导用户设置API密钥
 */
const FirstTimeGuide = ({ onContinue }) => {
  return (
    <div className="p-4 bg-blue-50 rounded-md mb-4">
      <h2 className="text-lg font-bold mb-2">欢迎使用漫画翻译助手!</h2>
      <p className="mb-2">使用前需要设置API密钥以激活翻译功能。</p>
      <p className="text-sm text-gray-600 mb-3">
        您可以从以下服务商获取API密钥：
        <ul className="list-disc ml-5 mt-1">
          <li>OpenAI (GPT)</li>
          <li>Anthropic (Claude)</li>
          <li>DeepSeek</li>
          <li>SiliconFlow (Qwen)</li>
        </ul>
      </p>
      <div className="bg-yellow-50 p-2 rounded border border-yellow-200 text-sm text-yellow-800 mb-3">
        <p className="flex items-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          出于安全考虑，我们不提供默认API密钥。您的API密钥将安全地存储在本地，不会发送给除AI服务提供商之外的任何第三方。
        </p>
      </div>
      <button
        onClick={onContinue}
        className="w-full py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition"
      >
        前往设置
      </button>
    </div>
  );
};

export default FirstTimeGuide; 