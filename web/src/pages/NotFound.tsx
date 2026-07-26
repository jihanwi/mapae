import {Link} from "react-router-dom";
import {copy} from "../copy";
import {Medallion, PrimaryBtn} from "../components/ui";

/** 알 수 없는 라우트 / 렌더 에러 폴백 — 영문 기본 화면 대신 디자인 시스템에 맞춘 한국어 안내 (6-b) */
export default function NotFound() {
    return (
        <div className="max-w-page mx-auto px-4 sm:px-8 pt-16 pb-20 text-center">
            <div className="flex justify-center mb-5"><Medallion char="馬" size={88} dashed /></div>
            <h1 className="m-0 mb-2 text-[22px] font-bold">{copy.route404.title}</h1>
            <p className="m-0 mb-6 text-[14px] text-hanji-400">{copy.route404.note}</p>
            <Link to="/"><PrimaryBtn>{copy.route404.cta}</PrimaryBtn></Link>
        </div>
    );
}
