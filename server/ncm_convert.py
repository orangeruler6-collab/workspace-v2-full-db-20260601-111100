# -*- coding: utf-8 -*-
"""
NCM (网易云音乐) 转 MP3 转换器
NCM = Netease Cloud Music 加密格式
"""
import sys
import os
import struct
import json

# NCM 固定 RC4 密钥（固定部分，用于解密 key）
NCM_FIXED_KEY = [
    0x68, 0x7A, 0x48, 0x5F, 0xE2, 0x53, 0xCB, 0xC5,
    0xB2, 0xD3, 0x71, 0x05, 0x53, 0x2A, 0xA2, 0x6D,
    0x34, 0x7F, 0x35, 0xF0, 0xE1, 0x5A, 0x0B, 0x4D,
    0x08, 0x19, 0xF3, 0x28, 0xB0, 0xCE, 0x4C, 0x16,
    0x22, 0x73, 0xEF, 0x1C, 0xEE, 0x36, 0x95, 0x5A,
    0x01, 0xC5, 0x4E, 0xB8, 0x67, 0x79, 0xE6, 0x8D,
    0x5D, 0x75, 0xDB, 0x82, 0x1A, 0x7E, 0x5B, 0xEF,
    0x31, 0x95, 0x5E, 0x51, 0xF8, 0x54, 0x02, 0xE9,
    0x52, 0xC8, 0x37, 0x1C, 0x92, 0xA5, 0xC0, 0x2D,
    0xB8, 0xC6, 0xDA, 0xE0, 0xC4, 0xD6, 0x6F, 0x0A,
    0xA9, 0x1A, 0xD7, 0x52, 0xCF, 0x49, 0x4B, 0xBB,
    0x26, 0xC3, 0xEB, 0x1D, 0x94, 0xDE, 0xD4, 0xC5,
    0x5C, 0x38, 0x0B, 0x87, 0x07, 0xF6, 0x79, 0x37,
    0xCE, 0xCC, 0xEB, 0x31, 0x2D, 0x51, 0x20, 0x6C,
    0xA9, 0x33, 0xE4, 0x5B, 0x3D, 0x9C, 0xCB, 0x79,
    0x09, 0x3B, 0x86, 0x4F, 0x86, 0x07, 0x9C, 0x2B
]


def rc4_crypt(data, key):
    """RC4 加解密（对称）"""
    S = list(range(256))
    j = 0
    for i in range(256):
        j = (j + S[i] + key[i % len(key)]) % 256
        S[i], S[j] = S[j], S[i]
    i = j = 0
    out = []
    for byte in data:
        i = (i + 1) % 256
        j = (j + S[i]) % 256
        S[i], S[j] = S[j], S[i]
        out.append(byte ^ S[(S[i] + S[j]) % 256])
    return bytes(out)


def find_mp3_start(data):
    """在解密后的数据中找 MP3 帧同步"""
    for i in range(len(data) - 4):
        if data[i] == 0xFF and (data[i+1] & 0xE0) == 0xE0:
            return i
        if data[i:i+4] == b'fLaC':
            return i
    return -1


def convert_ncm(ncm_path, mp3_path=None):
    """
    将 NCM 文件转换为 MP3
    """
    if mp3_path is None:
        mp3_path = os.path.splitext(ncm_path)[0] + '.mp3'

    with open(ncm_path, 'rb') as f:
        ncm_data = f.read()

    if ncm_data[:3] != b'CTN':
        return {'code': 1, 'error': '非 NCM 格式文件'}

    fixed_key = bytes(NCM_FIXED_KEY)

    # ====== 解析 NCM 头部结构 ======
    offset = 0
    # 1. 固定头 8 字节: CTN + format(4字节) + 保留(1字节?)
    offset = 8

    # 2. key data: 4字节大端长度 + key数据 + 4字节CRC
    key_data_len = int.from_bytes(ncm_data[offset:offset+4], 'big')
    offset += 4
    key_data = ncm_data[offset:offset+key_data_len]
    offset += key_data_len
    offset += 4  # CRC

    # 3. ncm metadata header: 4字节小端 size
    ncm_hdr_size = int.from_bytes(ncm_data[offset:offset+4], 'little')
    offset += 4 + ncm_hdr_size

    # ====== 音频数据：RC4 解密 ======
    audio_enc = ncm_data[offset:]
    audio_dec = rc4_crypt(audio_enc, fixed_key)

    # 找 MP3 帧开始
    mp3_start = find_mp3_start(audio_dec)
    if mp3_start < 0:
        return {'code': 1, 'error': '解密后未找到音频数据，可能格式不支持'}

    audio_final = audio_dec[mp3_start:]

    with open(mp3_path, 'wb') as f:
        f.write(audio_final)

    return {'code': 0, 'mp3_path': mp3_path}


def main(params):
    p = params.get('params', params)
    ncm_path = p.get('ncm_path', '')
    mp3_path = p.get('mp3_path', '')

    if not ncm_path:
        return {'code': 1, 'error': 'ncm_path required'}
    if not os.path.exists(ncm_path):
        return {'code': 1, 'error': '文件不存在: ' + ncm_path}

    return convert_ncm(ncm_path, mp3_path or None)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'code': -1, 'error': 'Usage: ncm_convert.py <json_params_file>'}))
    else:
        with open(sys.argv[1], 'r', encoding='utf-8') as f:
            args = json.load(f)
        result = main(args)
        print(json.dumps(result, ensure_ascii=False))
