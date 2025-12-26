/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 123网盘分享链接解析客户端
 * 基于 OpenList 源码实现
 */

const API_BASE = 'https://www.123pan.com/b/api';
const FILE_LIST_API = API_BASE + '/share/get';
const DOWNLOAD_INFO_API = API_BASE + '/share/download/info';

interface Pan123File {
  FileId: number;
  FileName: string;
  Size: number;
  Type: number; // 0=文件夹, 1=文件
  Etag: string;
  S3KeyFlag: string;
}

interface Pan123FilesResponse {
  code: number;
  message: string;
  data: {
    InfoList: Pan123File[];
    Next: string;
  };
}

interface Pan123DownloadResponse {
  code: number;
  message: string;
  data: {
    DownloadURL: string;
  };
}

export class Pan123ShareClient {
  private shareKey: string;
  private sharePwd: string;

  constructor(shareKey: string, sharePwd?: string) {
    this.shareKey = shareKey;
    this.sharePwd = sharePwd || '';
  }

  /**
   * 生成 123 网盘 API 签名
   */
  private signPath(path: string, os: string = 'web', version: string = '3'): { timeSign: string; sign: string } {
    const table = ['a', 'd', 'e', 'f', 'g', 'h', 'l', 'm', 'y', 'i', 'j', 'n', 'o', 'p', 'k', 'q', 'r', 's', 't', 'u', 'b', 'c', 'v', 'w', 's', 'z'];

    const random = Math.round(1e7 * Math.random()).toString();
    const now = new Date();
    const timestamp = Math.floor(now.getTime() / 1000).toString();

    // 格式化时间: 200601021504 (YYMMDDHHmmss)
    const year = now.getFullYear().toString().slice(2);
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const timeStr = year + month + day + hour + minute;

    // 转换时间字符串
    let nowStr = '';
    for (let i = 0; i < timeStr.length; i++) {
      const digit = parseInt(timeStr[i]);
      nowStr += table[digit];
    }

    const timeSign = this.crc32(nowStr).toString();
    const data = [timestamp, random, path, os, version, timeSign].join('|');
    const dataSign = this.crc32(data).toString();
    const sign = [timestamp, random, dataSign].join('-');

    return { timeSign, sign };
  }

  /**
   * CRC32 校验和计算
   */
  private crc32(str: string): number {
    let crc = 0 ^ (-1);
    for (let i = 0; i < str.length; i++) {
      crc = (crc >>> 8) ^ this.crc32Table[(crc ^ str.charCodeAt(i)) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  private crc32Table = (() => {
    const table: number[] = [];
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      }
      table[i] = c;
    }
    return table;
  })();

  /**
   * 构建带签名的 API URL
   */
  private getSignedUrl(url: string): string {
    const urlObj = new URL(url);
    const { timeSign, sign } = this.signPath(urlObj.pathname);
    urlObj.searchParams.append(timeSign, sign);
    return urlObj.toString();
  }

  /**
   * 发起 API 请求
   */
  private async request(url: string, options: RequestInit = {}): Promise<any> {
    const signedUrl = this.getSignedUrl(url);

    const headers = {
      'origin': 'https://www.123pan.com',
      'referer': 'https://www.123pan.com/',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'platform': 'web',
      'app-version': '3',
      ...options.headers,
    };

    const response = await fetch(signedUrl, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.code !== 0) {
      throw new Error(data.message || '123网盘 API 请求失败');
    }

    return data;
  }

  /**
   * 获取分享文件列表
   */
  async getFileList(parentFileId: string = '0'): Promise<Pan123File[]> {
    const url = new URL(FILE_LIST_API);
    url.searchParams.append('limit', '100');
    url.searchParams.append('next', '0');
    url.searchParams.append('orderBy', 'file_id');
    url.searchParams.append('orderDirection', 'desc');
    url.searchParams.append('parentFileId', parentFileId);
    url.searchParams.append('shareKey', this.shareKey);
    if (this.sharePwd) {
      url.searchParams.append('SharePwd', this.sharePwd);
    }

    const data: Pan123FilesResponse = await this.request(url.toString());
    return data.data.InfoList || [];
  }

  /**
   * 获取文件下载地址
   */
  async getDownloadUrl(file: Pan123File): Promise<string> {
    const body = {
      shareKey: this.shareKey,
      SharePwd: this.sharePwd,
      etag: file.Etag,
      fileId: file.FileId,
      s3keyFlag: file.S3KeyFlag,
      size: file.Size,
    };

    const data: Pan123DownloadResponse = await this.request(DOWNLOAD_INFO_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    let downloadUrl = data.data.DownloadURL;

    // 解析 params 参数
    try {
      const urlObj = new URL(downloadUrl);
      const params = urlObj.searchParams.get('params');
      if (params) {
        const decoded = Buffer.from(params, 'base64').toString('utf-8');
        downloadUrl = decoded;
      }
    } catch (e) {
      // 如果解析失败,使用原始 URL
    }

    // 获取重定向后的真实下载地址
    const response = await fetch(downloadUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'Referer': 'https://www.123pan.com/',
      },
    });

    if (response.status === 302) {
      const location = response.headers.get('location');
      if (location) {
        return location;
      }
    }

    return downloadUrl;
  }

  /**
   * 解析分享链接并获取播放地址
   */
  async parseShareLinkAndGetPlayUrl(shareUrl: string, sharePwd?: string): Promise<{
    playUrl: string;
    fileName: string;
    fileSize: number;
  }> {
    // 从 URL 中提取 shareKey
    const urlObj = new URL(shareUrl);
    const pathParts = urlObj.pathname.split('/');
    const shareKey = pathParts[pathParts.length - 1] || this.shareKey;

    if (sharePwd) {
      this.sharePwd = sharePwd;
    }

    // 更新 shareKey
    this.shareKey = shareKey;

    // 获取文件列表
    const files = await this.getFileList();

    if (files.length === 0) {
      throw new Error('分享链接中没有文件');
    }

    // 查找第一个视频文件
    const videoFile = files.find(f =>
      f.Type === 1 && (
        f.FileName.endsWith('.mp4') ||
        f.FileName.endsWith('.mkv') ||
        f.FileName.endsWith('.avi') ||
        f.FileName.endsWith('.m3u8') ||
        f.FileName.endsWith('.flv')
      )
    );

    const targetFile = videoFile || files.find(f => f.Type === 1) || files[0];

    if (targetFile.Type === 0) {
      throw new Error('分享链接指向文件夹,请分享具体视频文件');
    }

    // 获取下载地址
    const playUrl = await this.getDownloadUrl(targetFile);

    return {
      playUrl,
      fileName: targetFile.FileName,
      fileSize: targetFile.Size,
    };
  }
}
