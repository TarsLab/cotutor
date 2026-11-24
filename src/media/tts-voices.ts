/**
 * 配音(听写念词、课包、点读)认的音色:百炼 Qwen-Audio-TTS 3.1 的系统音色,照官方音色列表整理的
 * (https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list,2026-11-25):
 * qwen-audio-3.1-tts-plus 的四个旗舰音色,qwen-audio-3.1-tts-flash 的精品中文、精品英文。
 * flash 的「多语种与方言」四个和 plus 的四个是同一个 id(同一个人),只当 plus 用;flash 的其他系统音色(角色、带货、陪伴之类)和小语种不收。
 * 3.1 的 id 不带模型前缀,模型照这张表(tts.ts 的 ttsModelOf);官方没写年纪,场景取列表里头一个。全部支持字级时间戳。
 * 3.0 的基础音色不在表里了:以前选了的照样能合成(id 带前缀,认得出模型),家长端列在最前面、标「以前选的」。
 * 家长端「样子与声音」点读的声音照这张表列、试听、挑(写进 cotutor.json 的 tutors.<名>.voice);老师开口的嘴是另一张表(src/realtime/voices.ts)。
 */

export interface TtsVoice {
  /** 合成请求的 voice 参数,也是 tutors.<名>.voice 里写的 */
  voice: string;
  /** 合成用的模型(音色不能跨模型用) */
  model: string;
  /** 官方的中文名 */
  name: string;
  /** 女 / 男;官方写「儿童」的空着 */
  gender: string;
  /** 官方没写的是 0 */
  age: number;
  trait: string;
  scene: string;
  lang: string;
}

const PLUS = 'qwen-audio-3.1-tts-plus', FLASH = 'qwen-audio-3.1-tts-flash';
const p = (voice: string, name: string, gender: string): TtsVoice => ({ voice, model: PLUS, name, gender, age: 0, trait: '旗舰音色,音质和朗读最好', scene: '朗读', lang: '中文' });
const f = (voice: string, name: string, gender: string, trait: string, scene: string, lang: string): TtsVoice => ({ voice, model: FLASH, name, gender, age: 0, trait, scene, lang });

export const TTS_VOICES: readonly TtsVoice[] = [
  p('longanlingxin_v3.1', '龙安灵心', '女'),
  p('xunanchuan_v3.1', '许南川', '男'),
  p('longanhuan_v3.1', '龙安欢', '女'),
  p('longanfengyue_v3.1', '龙安风悦', '女'),
  f('yuxiaoyun_v3.1', '于小云', '女', '元气、亲切、自然', '广告营销', '中文'),
  f('qiaoxiaojiao_v3.1', '乔小娇', '女', '俏丽、可爱', '广告营销', '中文'),
  f('xiaxiaochen_v3.1', '夏小晨', '女', '元气、明亮', '广告营销', '中文'),
  f('anmingyuan_v3.1', '安明远', '男', '清亮、自然', '广告营销', '中文'),
  f('wenhuaiqing_v3.1', '温怀清', '女', '清亮、柔和', '儿童故事', '中文'),
  f('anxiaolan_v3.1', '安小岚', '女', '清甜、纯净', '有声书', '中文'),
  f('xieshurou_v3.1', '谢舒柔', '女', '柔和、自然、知性', '有声书', '中文'),
  f('baiqinglan_v3.1', '白清岚', '女', '明亮、清纯', '语音助手', '中文'),
  f('xuyuyuan_v3.1', '许玉远', '女', '知性、成熟、质感', '广告营销', '中文'),
  f('anruorou_v3.1', '安若柔', '女', '气声、知性', '旁白', '中文'),
  f('wenhuaizhi_v3.1', '闻怀之', '女', '稳重、成熟', '有声书', '中文'),
  f('xiaoxingzhi_v3.1', '萧行之', '女', '端庄、贵气', '新闻播报', '中文'),
  f('guyunshu_v3.1', '顾云舒', '女', '成熟、稳重', '音乐电台', '中文'),
  f('huozhuoshi_v3.1', '霍拙石', '男', '清亮', '有声书', '中文'),
  f('yeqinghe_v3.1', '叶清禾', '女', '亲切、温柔', '有声书', '中文'),
  f('yunhuanhuan_v3.1', '云欢欢', '女', '高亢、热情', '有声书', '中文'),
  f('xuxiaoqiao_v3.1', '徐小俏', '女', '自然、俏皮', '有声书', '中文'),
  f('baianran_v3.1', '白安然', '女', '低沉、浑厚、气声', '配音讲解', '中文'),
  f('xuyanchu_v3.1', '许言初', '女', '沉稳、磁性', '新闻播报', '中文'),
  f('yezhiqing_v3.1', '叶知晴', '女', '轻快、自然', '儿童故事', '中文'),
  f('andi_v3.1', '安迪', '男', 'ABC口音', '语音助手', '中文'),
  f('anyuqing_v3.1', '安语晴', '女', '甜妹', '语音助手', '中文'),
  f('linxiaoling_v3.1', '林小灵', '女', '甜妹', '语音助手', '中文'),
  f('longfeifei_v3.1', '龙菲菲', '女', '甜妹', '社交陪伴', '中文'),
  f('longjing_v3.1', '龙婧', '女', '质感、沉稳', '新闻播报', '中文'),
  f('longqiang_v3.1', '龙嫱', '女', '浪漫、风情', '社交陪伴', '中文'),
  f('longyan_v3.1', '龙颜', '女', '温暖、自然、亲切', '社交陪伴', '中文'),
  f('longxiaobai_v3.1', '龙小白', '女', '磁性、质感', '新闻播报', '中文'),
  f('longyue_v3.1', '龙悦', '女', '温暖、磁性', '有声书', '中文'),
  f('longcheng_v3.1', '龙橙', '男', '智慧、磁性', '社交陪伴', '中文'),
  f('longlaotie_v3.1', '龙老铁', '男', '东北、直率', '方言', '中文'),
  f('longshao_v3.1', '龙邵', '男', '积极、元气', '社交陪伴', '中文'),
  f('longshu_v3.1', '龙书', '男', '沉稳、磁性', '新闻播报', '中文'),
  f('longze_v3.1', '龙泽', '男', '温暖、元气、自然', '社交陪伴', '中文'),
  f('longhao_v3.1', '龙浩', '男', '多情、忧郁', '社交陪伴', '中文'),
  f('longjin_v3.1', '龙津', '男', '优雅、温润', '诗词朗诵', '中文'),
  f('longnan_v3.1', '龙楠', '男', '睿智', '有声书', '中文'),
  f('longshuo_v3.1', '龙硕', '男', '博才、干练', '新闻播报', '中文'),
  f('longtian_v3.1', '龙天', '男', '磁性、理智', '社交陪伴', '中文'),
  f('longxiaocheng_v3.1', '龙小诚', '男', '磁性、低音', '社交陪伴', '中文'),
  f('longke_v3.1', '龙可', '', '懵懂', '童声', '中文'),
  f('loongbella_v3.1', 'Bella', '女', '干练、磁性、知性', '英文', '中英'),
  f('Emily_v3.1', 'Emily', '女', '英式女声', '', '英文'),
  f('Luna_v3.1', 'Luna', '女', '英式女声', '', '英文'),
  f('Eric_v3.1', 'Eric', '男', '英式男声', '', '英文'),
  f('Luca_v3.1', 'Luca', '男', '英式男声', '', '英文'),
  f('Abby_v3.1', 'Abby', '女', '美式女声', '', '英文'),
  f('Annie_v3.1', 'Annie', '女', '美式女声', '', '英文'),
  f('Ava_v3.1', 'Ava', '女', '美式女声', '', '英文'),
  f('Beth_v3.1', 'Beth', '女', '美式女声', '', '英文'),
  f('Betty_v3.1', 'Betty', '女', '美式女声', '', '英文'),
  f('Cally_v3.1', 'Cally', '女', '美式女声', '', '英文'),
  f('Cindy_v3.1', 'Cindy', '女', '美式女声', '', '英文'),
  f('Donna_v3.1', 'Donna', '女', '美式女声', '', '英文'),
  f('Andy_v3.1', 'Andy', '男', '美式男声', '', '英文'),
  f('Brian_v3.1', 'Brian', '男', '美式男声', '', '英文'),
  f('David_v3.1', 'David', '男', '美式男声', '', '英文'),
];
