mod loader;
mod parse;

pub use parse::WsdlInfo;

use crate::error::AppResult;

pub async fn inspect(source: &str, verify_tls: bool) -> AppResult<WsdlInfo> {
    let docs = loader::load_all(source, verify_tls).await?;
    parse::inspect(source, &docs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const TYPES: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="http://example.test/orders"
           targetNamespace="http://example.test/orders" elementFormDefault="qualified">
  <xs:complexType name="Entity">
    <xs:sequence><xs:element name="Id" type="xs:int"/></xs:sequence>
  </xs:complexType>
  <xs:complexType name="Order">
    <xs:complexContent>
      <xs:extension base="tns:Entity">
        <xs:sequence>
          <xs:element name="Customer" type="xs:string" minOccurs="0"/>
          <xs:element name="Lines" type="tns:Line" maxOccurs="unbounded"/>
          <xs:choice>
            <xs:element name="Card" type="xs:string"/>
            <xs:element name="Cash" type="xs:boolean"/>
          </xs:choice>
          <xs:element name="Parent" type="tns:Order" minOccurs="0"/>
        </xs:sequence>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>
  <xs:complexType name="Line">
    <xs:sequence>
      <xs:element name="Sku" type="xs:string"/>
      <xs:element name="Qty" type="xs:int"/>
    </xs:sequence>
  </xs:complexType>
  <xs:element name="CreateOrder">
    <xs:complexType><xs:sequence><xs:element name="order" type="tns:Order"/></xs:sequence></xs:complexType>
  </xs:element>
  <xs:element name="Ping"><xs:complexType/></xs:element>
</xs:schema>"#;

    const SERVICE: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<wsdl:definitions name="OrderService" targetNamespace="http://example.test/orders/wsdl"
    xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
    xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:xs="http://www.w3.org/2001/XMLSchema"
    xmlns:tns="http://example.test/orders/wsdl" xmlns:ord="http://example.test/orders">
  <wsdl:types>
    <xs:schema><xs:import namespace="http://example.test/orders" schemaLocation="types.xsd"/></xs:schema>
  </wsdl:types>
  <wsdl:message name="CreateOrderIn"><wsdl:part name="parameters" element="ord:CreateOrder"/></wsdl:message>
  <wsdl:message name="PingIn"><wsdl:part name="parameters" element="ord:Ping"/></wsdl:message>
  <wsdl:portType name="IOrders">
    <wsdl:operation name="CreateOrder"><wsdl:input message="tns:CreateOrderIn"/></wsdl:operation>
    <wsdl:operation name="Ping"><wsdl:input message="tns:PingIn"/></wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="Basic" type="tns:IOrders">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http" style="document"/>
    <wsdl:operation name="CreateOrder">
      <soap:operation soapAction="http://example.test/IOrders/CreateOrder"/>
      <wsdl:input><soap:body use="literal"/></wsdl:input>
    </wsdl:operation>
    <wsdl:operation name="Ping">
      <soap:operation soapAction="http://example.test/IOrders/Ping"/>
      <wsdl:input><soap:body use="literal"/></wsdl:input>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:binding name="Soap12" type="tns:IOrders">
    <soap12:binding transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="Ping">
      <soap12:operation soapAction="http://example.test/IOrders/Ping"/>
      <wsdl:input><soap12:body use="literal"/></wsdl:input>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="OrderService">
    <wsdl:port name="BasicPort" binding="tns:Basic"><soap:address location="https://svc.test/Orders.svc"/></wsdl:port>
    <wsdl:port name="Soap12Port" binding="tns:Soap12"><soap12:address location="https://svc.test/Orders.svc/12"/></wsdl:port>
  </wsdl:service>
</wsdl:definitions>"#;

    const RPC: &str = r#"<definitions name="Calc" targetNamespace="urn:calc" xmlns="http://schemas.xmlsoap.org/wsdl/"
    xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:tns="urn:calc">
  <message name="AddIn"><part name="a" type="xsd:int"/><part name="b" type="xsd:int"/></message>
  <portType name="CalcPT"><operation name="Add"><input message="tns:AddIn"/></operation></portType>
  <binding name="CalcB" type="tns:CalcPT">
    <soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/>
    <operation name="Add"><soap:operation soapAction="urn:calc#Add"/><input><soap:body use="literal" namespace="urn:calc"/></input></operation>
  </binding>
  <service name="CalcService"><port name="CalcPort" binding="tns:CalcB"><soap:address location="http://calc.test/"/></port></service>
</definitions>"#;

    #[tokio::test]
    async fn document_literal_with_imports() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("types.xsd"), TYPES).unwrap();
        fs::write(dir.path().join("service.wsdl"), SERVICE).unwrap();
        let info = inspect(dir.path().join("service.wsdl").to_str().unwrap(), true)
            .await
            .unwrap();

        assert_eq!(info.name, "OrderService");
        assert_eq!(info.documents, 2);
        let ports = &info.services[0].ports;
        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].soap_version, "1.1");
        assert_eq!(ports[0].address, "https://svc.test/Orders.svc");
        assert_eq!(ports[1].soap_version, "1.2");

        let create = &ports[0].operations[0];
        assert_eq!(create.action, "http://example.test/IOrders/CreateOrder");
        let env = &create.envelope;
        assert!(env.starts_with("<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ord=\"http://example.test/orders\">"), "{env}");
        for expected in [
            "<ord:CreateOrder>",
            "<ord:order>",
            "<ord:Id>?</ord:Id>",
            "<!--Optional:-->",
            "<ord:Customer>?</ord:Customer>",
            "<!--1 or more repetitions:-->",
            "<ord:Sku>?</ord:Sku>",
            "<!--You have a CHOICE of the next 2 items at this level-->",
            "<ord:Parent><!--recursive type Order--></ord:Parent>",
        ] {
            assert!(env.contains(expected), "missing {expected} in\n{env}");
        }
        assert!(ports[1].operations[0]
            .envelope
            .contains("<soap:Envelope xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\""));
        assert!(ports[0].operations[1].envelope.contains("<ord:Ping>?</ord:Ping>"));
        assert!(info.warnings.is_empty(), "{:?}", info.warnings);
    }

    #[tokio::test]
    async fn rpc_literal() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("calc.wsdl"), RPC).unwrap();
        let info = inspect(dir.path().join("calc.wsdl").to_str().unwrap(), true)
            .await
            .unwrap();
        let op = &info.services[0].ports[0].operations[0];
        assert_eq!(op.style, "rpc");
        assert!(
            op.envelope
                .contains("<tns:Add>\n      <a>?</a>\n      <b>?</b>\n    </tns:Add>"),
            "{}",
            op.envelope
        );
    }

    #[tokio::test]
    async fn rejects_non_wsdl_and_dtd() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("x.xml"), "<a/>").unwrap();
        assert!(inspect(dir.path().join("x.xml").to_str().unwrap(), true).await.is_err());
        let xxe = r#"<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d>&x;</d>"#;
        fs::write(dir.path().join("xxe.wsdl"), xxe).unwrap();
        assert!(inspect(dir.path().join("xxe.wsdl").to_str().unwrap(), true)
            .await
            .is_err());
    }
}
