/**
 * 嘴(百炼 realtime,qwen3.8-omni-flash-realtime)认的音色:官方列表 https://www.alibabacloud.com/help/zh/model-studio/omni-voice-list 里
 * 「Qwen3.8-Omni 系列」那 56 个(2026-10-19 照抄;每个都真连过一次让它说一个字,都出声)。trait 是官方描述的概括,lang 是除外语以外会说的(都另会 28 种外语)。
 * 旧模型的 Bella、Pip、Chelsie、Ethan 这个模型不认:连接照样连得上,第一次开口才报 InvalidParameter——所以写错的音色要在配置这一头拦(工作台、doctor)。
 * 工作台音色页「实时的嘴」那一半照这张表列、试听、挑(写进 cotutor.json 的 live.voices)。
 * 英语老师的讲稿是中文里夹英文(「apple 苹果,banana 香蕉」):2026-10-20 真连(照念 → 转写回字)Serena、Tina、Maia、Liora Mira、Mione、Theo Calm 都念对,
 * Jennifer、Mia 的中文带英文腔(Jennifer:「腿」成了 tway,「它是什么颜色」没了),trait 里记着。
 */

export interface RealtimeVoice {
  /** session.update 的 voice 参数(大小写、空格照官方) */
  voice: string;
  /** 官方的中文名 */
  name: string;
  trait: string;
  lang: string;
}

const v = (voice: string, name: string, trait: string, lang = '普通话'): RealtimeVoice => ({ voice, name, trait, lang });

export const REALTIME_VOICES: readonly RealtimeVoice[] = [
  v('Tina', '甜甜', '甜美温暖,解决问题果断(缺省)'),
  v('Cindy', '林欣宜', '台湾腔嗲嗲的小姐姐', '台湾口音'),
  v('Liora Mira', '清欢', '温柔的烟火人间感'),
  v('Raymond', '林川野', '声音清亮,爱吃外卖的宅男'),
  v('Zane', '泽恩', '磁性迷人'),
  v('Katerina', '卡捷琳娜', '御姐音,韵律感强'),
  v('Ryan', '甜茶', '节奏感强,戏感足'),
  v('Mia', '舒然', '细腻,生活美学风格的温柔博主;中英夹着说时中文带英文腔'),
  v('Cici', '绵绵', '邻家妹妹,活泼软糯'),
  v('Theo Calm', '予安', '沉静,治愈感'),
  v('Serena', '苏瑶', '温柔小姐姐'),
  v('Maia', '四月', '知性与温柔'),
  v('Evan', '江晨', '男大学生,年下奶狗'),
  v('Qiao', '小乔妹', '表面甜妹,个性十足', '台湾口音'),
  v('Momo', '茉兔', '撒娇搞怪'),
  v('Wil', '伟伦', '深圳长大的港台腔小哥哥'),
  v('Angel', '安琪', '带台式口音,甜美'),
  v('Li Cassian', '李公公', '话中有留白,善察言观色'),
  v('Joyner', '阿逗', '搞笑、夸张、接地气'),
  v('Gold', '金爷', '西海岸黑人说唱歌手风格'),
  v('Jennifer', '詹妮弗', '电影质感的美语女声;中英夹着说时中文带英文腔(苹果念成 pingguo)'),
  v('Aiden', '艾登', '精通厨艺的美语大男孩'),
  v('Mione', '敏儿', '成熟知性的英国邻家妹妹'),
  v('Sunny', '晴儿', '甜美的川妹子', '四川话'),
  v('Dylan', '晓东', '北京胡同长大的少年', '北京话'),
  v('Eric', '程川', '成都市井男子,跳脱', '四川话'),
  v('Peter', '李彼得', '天津相声,专业捧哏', '天津话'),
  v('Joseph Chen', '阿樸伯', '南洋老华侨', '闽南话'),
  v('Marcus', '秦川', '老陕风格,面宽话短', '陕西话'),
  v('Li', '老李', '南京话伯伯,爱骂骂咧咧', '南京话'),
  v('Rocky', '阿强', '幽默风趣,在线陪聊', '粤语'),
  v('Kiki', '阿清', '甜美的港妹闺蜜', '粤语'),
  v('Sohee', '素熙', '温柔开朗的韩国欧尼'),
  v('Eliška', '艾莉卡', '中欧风格'),
  v('Alek', '阿列克', '战斗民族的冷与暖'),
  v('Arda', '阿尔达', '干净利落,温润'),
  v('Dolce', '多尔切', '慵懒的意大利大叔'),
  v('Lenn', '莱恩', '德国青年,理性中带叛逆'),
  v('Ono Anna', '小野杏', '鬼灵精怪的青梅竹马'),
  v('Sonrisa', '索尼莎', '热情开朗的拉美大姐'),
  v('Bodega', '博德加', '热情的西班牙大叔'),
  v('Andre', '安德雷', '磁性、沉稳的男生'),
  v('Radio Gol', '拉迪奥·戈尔', '足球解说风格'),
  v('Rizky', '阿力', '印尼青年,声线个性'),
  v('Roya', '萝雅', '热爱运动的女孩'),
  v('Hana', '阿幸', '越南成熟姐姐'),
  v('Jakub', '雅克', '波兰文艺青年,声线磁性'),
  v('Griet', '海娜', '荷兰成熟文艺女性'),
  v('Marina', '玛丽娜', '多元文化城市长大的女孩'),
  v('Siiri', '西芮', '内敛温柔,语速舒缓'),
  v('Ingrid', '林恩', '挪威乡村姑娘'),
  v('Sigga', '海娜', '冰岛小镇知性女青年'),
  v('Bea', '雅娜', '爱喝咖啡的甜美姐姐'),
  v('Chloe', '思怡', '马来西亚白领女生'),
  v('Emilien', '埃米尔安', '浪漫的法国大哥哥'),
  v('longanlingxin', '龙安灵心', '知心温暖音'),
];

/** 这个模型认不认这个音色(工作台、doctor 拦写错的) */
export function isRealtimeVoice(voice: string): boolean {
  return REALTIME_VOICES.some((x) => x.voice === voice);
}
