import type {Metadata} from "next";import "./admin.css";import "./admin-enhancements.css";
export const metadata:Metadata={title:"Admin | ODESVIA",robots:{index:false,follow:false}};
export default function AdminRoot({children}:{children:React.ReactNode}){return <div className="admin-body">{children}</div>}
