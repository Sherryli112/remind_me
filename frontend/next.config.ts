import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // dev 模式的「N」指示器會出現在透明彈窗視窗裡蓋住卡片內容
  devIndicators: false,
};

export default nextConfig;
