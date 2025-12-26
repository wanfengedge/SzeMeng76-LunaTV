/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 115网盘分享链接解析客户端
 * 基于 OpenList 源码实现
 *
 * 注意: 115网盘需要登录凭证(Cookie)才能访问分享链接
 */

const SHARE_SNAP_API = 'https://webapi.115.com/share/snap';
const SHARE_DOWNLOAD_API = 'https://proapi.115.com/app/share/downurl';

interface Cloud115File {
  fid: string;
  fn: string; // 文件名
  fs: number; // 文件大小
  ico: string; // 文件类型图标
  pc: string; // 父目录ID
}

interface Cloud115ShareSnapResponse {
  state: boolean;
  error?: string;
  data?: {
    list: Cloud115File[];
    count: number;
  };
}

interface Cloud115DownloadResponse {
  state: boolean;
  error?: string;
  data?: {
    [key: string]: {
      url: {
        url: string;
      };
    };
  };
}

export class Cloud115ShareClient {
  private cookie: string;
  private shareCode: string;
  private receiveCode: string;

  constructor(cookie: string, shareCode: string, receiveCode: string) {
    this.cookie = cookie;
    this.shareCode = shareCode;
    this.receiveCode = receiveCode;
  }

  /**
   * 发起 API 请求
   */
  private async request(url: string, options: RequestInit = {}): Promise<any> {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Cookie': this.cookie,
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.state) {
      throw new Error(data.error || '115网盘 API 请求失败');
    }

    return data;
  }

  /**
   * 获取分享快照(文件列表)
   */
  async getShareSnap(cid: string = '0', offset: number = 0, limit: number = 1150): Promise<Cloud115File[]> {
    const url = new URL(SHARE_SNAP_API);
    url.searchParams.append('share_code', this.shareCode);
    url.searchParams.append('receive_code', this.receiveCode);
    url.searchParams.append('cid', cid);
    url.searchParams.append('offset', offset.toString());
    url.searchParams.append('limit', limit.toString());

    const data: Cloud115ShareSnapResponse = await this.request(url.toString());

    if (!data.data) {
      return [];
    }

    return data.data.list || [];
  }

  /**
   * 获取文件下载地址
   */
  async getDownloadUrl(fileId: string): Promise<string> {
    const url = new URL(SHARE_DOWNLOAD_API);
    url.searchParams.append('share_code', this.shareCode);
    url.searchParams.append('receive_code', this.receiveCode);
    url.searchParams.append('file_id', fileId);

    const data: Cloud115DownloadResponse = await this.request(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!data.data) {
      throw new Error('无法获取下载地址');
    }

    // 115 API 返回格式: { "文件ID": { "url": { "url": "实际下载地址" } } }
    const fileData = data.data[fileId];
    if (!fileData || !fileData.url || !fileData.url.url) {
      throw new Error('下载地址解析失败');
    }

    return fileData.url.url;
  }

  /**
   * 解析分享链接并获取播放地址
   */
  async parseShareLinkAndGetPlayUrl(shareUrl: string, sharePwd?: string): Promise<{
    playUrl: string;
    fileName: string;
    fileSize: number;
  }> {
    // 从 URL 中提取 shareCode
    // 115分享链接格式: https://115.com/s/shareCode#receiveCode
    // 或: https://115.com/s/shareCode?password=receiveCode

    const urlObj = new URL(shareUrl);
    const pathParts = urlObj.pathname.split('/');
    const shareCode = pathParts[pathParts.length - 1] || this.shareCode;

    // 提取密码
    let receiveCode = this.receiveCode;
    if (sharePwd) {
      receiveCode = sharePwd;
    } else if (urlObj.hash) {
      receiveCode = urlObj.hash.substring(1); // 移除 # 号
    } else if (urlObj.searchParams.get('password')) {
      receiveCode = urlObj.searchParams.get('password') || '';
    }

    // 更新 shareCode 和 receiveCode
    this.shareCode = shareCode;
    this.receiveCode = receiveCode;

    // 获取文件列表
    const files = await this.getShareSnap();

    if (files.length === 0) {
      throw new Error('分享链接中没有文件');
    }

    // 查找第一个视频文件
    const videoFile = files.find(f =>
      f.fn.endsWith('.mp4') ||
      f.fn.endsWith('.mkv') ||
      f.fn.endsWith('.avi') ||
      f.fn.endsWith('.m3u8') ||
      f.fn.endsWith('.flv') ||
      f.fn.endsWith('.ts')
    );

    const targetFile = videoFile || files[0];

    // 获取下载地址
    const playUrl = await this.getDownloadUrl(targetFile.fid);

    return {
      playUrl,
      fileName: targetFile.fn,
      fileSize: targetFile.fs,
    };
  }

  /**
   * 从分享链接中提取 shareCode 和 receiveCode (静态方法)
   */
  static parseShareUrl(shareUrl: string): { shareCode: string; receiveCode?: string } {
    const urlObj = new URL(shareUrl);
    const pathParts = urlObj.pathname.split('/');
    const shareCode = pathParts[pathParts.length - 1];

    let receiveCode: string | undefined;
    if (urlObj.hash) {
      receiveCode = urlObj.hash.substring(1);
    } else if (urlObj.searchParams.get('password')) {
      receiveCode = urlObj.searchParams.get('password') || undefined;
    }

    return { shareCode, receiveCode };
  }
}
