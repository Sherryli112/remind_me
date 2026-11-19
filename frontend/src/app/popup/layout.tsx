import './popup.css';
import { DesktopOnly } from '../../components/DesktopOnly';

// 彈窗只在桌面 App 裡使用；在瀏覽器開啟時 DesktopOnly 會導回首頁
export default function PopupLayout({ children }: { children: React.ReactNode }) {
  return <DesktopOnly>{children}</DesktopOnly>;
}
